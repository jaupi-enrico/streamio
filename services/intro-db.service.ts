// intro-db.service.ts
//
// Client for TheIntroDB (https://theintrodb.org) — a free, community-sourced
// database of intro/recap/credits/preview timestamps, keyed by TMDB/IMDB id
// (+ season/episode for TV). Powers the watch page's "Skip Intro" button.
// Talks to the API via the official `theintrodb` npm client, which already
// handles request validation, response parsing, and null-timestamp
// normalization (start=null -> 0, end=null -> "runs to end of media").
// Targets API v4, where a media's identity is its TVDB id; a TMDB or IMDB id
// still resolves to it server-side, and season/episode are read in the
// numbering of whichever id was sent — the IMDB id on file here — so no
// `mapping` (episode order) needs passing.
//
// `local_titles` can carry a real `imdb_id` (filled in by hand or via the
// admin "fill in from a TMDB id" flow, see `services/tmdb-import.service.ts`)
// — when a title has one, the caller sends it and this looks segments up
// directly. There is no title-matching fallback: with no scraped source left
// to guess an id for, a title with neither an id nor one on file simply has
// no lookup to make.
//
// Redis-cached and fail silent — this feature must never be able to block or
// break playback.
import {
  createIntroDbClient,
  TheIntroDbApiError,
  type MediaRecord,
} from "theintrodb";
import type { Redis } from "../database/redis.js";

const SEGMENTS_TTL_SECONDS = 60 * 60 * 12; // 12h — timestamps rarely change
const SEGMENTS_NONE_TTL_SECONDS = 60 * 30; // 30m — short, so a title added later is picked up

// API v4 answers with the release version (theatrical, extended, uncensored,
// ...) closest to the duration it was given, so two cuts of one title are two
// different answers and must not share a cache entry. Bucketed to the minute:
// encodes of the same release differ by seconds, distinct cuts by minutes.
const DURATION_BUCKET_MS = 60_000;

// Self-throttle well under TheIntroDB's ~30 req/10s server-enforced limit.
const MAX_REQUESTS_PER_WINDOW = 20;
const WINDOW_MS = 10_000;
const DEFAULT_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export type IntroDbMedia = MediaRecord;

export interface IntroLookupParams {
  type: "movie" | "tv";
  tmdbId?: number;
  imdbId?: string;
  season?: number;
  episode?: number;
  durationMs?: number;
}

interface ResolvedIds {
  tmdbId?: number;
  imdbId?: string;
}

const NONE = "none" as const;

// Bumped with the API version: a cached v3 body has no `kind` and the wrong id.
const CACHE_PREFIX = "introdb:v4";

const client = createIntroDbClient({
  apiKey: process.env.THEINTRODB_API_KEY?.trim() || undefined,
});

export class IntroDbService {
  private inFlightSegments = new Map<string, Promise<IntroDbMedia | null>>();
  private requestTimestamps: number[] = [];
  private cooldownUntil = 0;

  constructor(private redis: Redis) {}

  async lookup(params: IntroLookupParams): Promise<IntroDbMedia | null> {
    const ids: ResolvedIds | null = params.tmdbId
      ? { tmdbId: params.tmdbId }
      : params.imdbId
        ? { imdbId: params.imdbId }
        : null;
    if (!ids) return null;
    return this.fetchSegments(ids, params);
  }

  // ── TheIntroDB GET /media (via the official client), cached/throttled/fail-silent ──

  private async fetchSegments(
    ids: ResolvedIds,
    params: IntroLookupParams
  ): Promise<IntroDbMedia | null> {
    const key = this.segmentsCacheKey(ids, params);

    const cached = await this.redis.get<IntroDbMedia | typeof NONE>(key).catch(() => null);
    if (cached === NONE) return null;
    if (cached && typeof cached === "object") return cached;

    const existing = this.inFlightSegments.get(key);
    if (existing) return existing;

    const build = this.fetchAndCacheSegments(key, ids, params).finally(() => {
      this.inFlightSegments.delete(key);
    });
    this.inFlightSegments.set(key, build);
    return build;
  }

  private segmentsCacheKey(ids: ResolvedIds, params: IntroLookupParams): string {
    const id = ids.tmdbId ? `tmdb:${ids.tmdbId}` : `imdb:${ids.imdbId}`;
    const suffix = params.type === "tv" ? `:s${params.season}:e${params.episode}` : "";
    const cut = params.durationMs
      ? `:d${Math.round(params.durationMs / DURATION_BUCKET_MS)}`
      : "";
    return `${CACHE_PREFIX}:${id}${suffix}${cut}`;
  }

  private async fetchAndCacheSegments(
    key: string,
    ids: ResolvedIds,
    params: IntroLookupParams
  ): Promise<IntroDbMedia | null> {
    if (Date.now() < this.cooldownUntil) return null; // still backing off from a 429

    try {
      await this.throttle();

      const result = await client.getMedia({
        tmdbId: ids.tmdbId,
        imdbId: ids.imdbId,
        season: params.type === "tv" ? params.season : undefined,
        episode: params.type === "tv" ? params.episode : undefined,
        durationMs: params.durationMs,
      });

      // v4 answers a media with no submissions with a per-episode count list
      // (`kind: "episodes"`) rather than a 404 — same meaning: nothing to skip.
      if (result.kind !== "media") {
        await this.redis.set(key, NONE, SEGMENTS_NONE_TTL_SECONDS).catch(() => {});
        return null;
      }
      const media = result;

      await this.redis.set(key, media, SEGMENTS_TTL_SECONDS).catch(() => {});
      return media;
    } catch (err) {
      if (err instanceof TheIntroDbApiError) {
        if (err.status === 404) {
          await this.redis.set(key, NONE, SEGMENTS_NONE_TTL_SECONDS).catch(() => {});
          return null;
        }
        if (err.status === 429 && err.code === "specific_media_usage_limit_exceeded") {
          // A cap on this one title, not on us — backing off globally would
          // take the button away from every other title too.
          const waitMs = this.backoffMs(err.rateLimit.specificMediaResetSeconds);
          await this.redis.set(key, NONE, Math.ceil(waitMs / 1000)).catch(() => {});
          return null;
        }
        if (err.status === 429) {
          this.applyBackoff(err.rateLimit);
          return null; // not cached — retry once the cooldown passes
        }
      }

      // `key` is built from caller-supplied ids, and console's first argument
      // is a format string — a `%s` in there would swallow the error being
      // logged. Passed as an argument instead, it is only ever data.
      console.error(
        "[intro-db] segment lookup failed for",
        key,
        err instanceof Error ? err.message : err
      );
      return null; // never cached — never blocks playback, just retries next time
    }
  }

  private applyBackoff(rateLimit: TheIntroDbApiError["rateLimit"]) {
    const waitMs = this.backoffMs(
      rateLimit?.usageResetSeconds ?? rateLimit?.rateLimitResetSeconds ?? null
    );
    this.cooldownUntil = Date.now() + waitMs;
    console.warn(`[intro-db] rate limited, backing off ${waitMs}ms`);
  }

  private backoffMs(resetSeconds: number | null | undefined): number {
    const waitMs = resetSeconds != null ? resetSeconds * 1000 : DEFAULT_BACKOFF_MS;
    return Math.min(Math.max(waitMs, 1_000), MAX_BACKOFF_MS);
  }

  private async throttle() {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < WINDOW_MS);
    if (this.requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
      const waitMs = WINDOW_MS - (now - this.requestTimestamps[0]);
      await new Promise((r) => setTimeout(r, Math.max(waitMs, 0)));
    }
    this.requestTimestamps.push(Date.now());
  }
}
