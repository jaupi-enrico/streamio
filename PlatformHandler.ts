import { PlatformHandler } from "./core/models/PlatformHandler.js";
import { Database } from "./database/db.js";
import { Redis } from "./database/redis.js";
import type { Genre } from "./core/models/index.js";

export class WebPlatformHandler extends PlatformHandler {
  db: Database;
  redis: Redis;
  ready: boolean = false;

  // TTLs in seconds
  private static readonly TTL = {
    HOME: 60 * 10,         // 10 min — home change occasionally
    SEARCH: 60 * 60,      // 1 hr — search results don't change often for the same query
    SHOW_DETAILS: 60 * 60,// 1 hr — show details don't change often
    EPISODES: 60 * 10,    // 10 min — episode lists can change with new releases
    SERVERS: 60 * 2,      // 2 min — server lists can rotate quickly
    VIDEO: 60 * 1,        // 1 min — resolved URLs often expire fast
    GENRES: 60 * 60 * 6,  // 6 hr — a site's genre catalogue is near-static
    GENRE: 60 * 30,       // 30 min — a genre's titles change with new releases
  } as const;

  // A successful-but-empty result gets this short TTL instead of the
  // endpoint's usual one. A struggling provider that resolves empty (rather
  // than rejecting — see core/core.ts's timeout/rethrow handling for the
  // rejection path) would otherwise poison the cache for everyone until the
  // full TTL expires; 30s lets a real recovery or a legitimately-empty
  // result self-heal fast without hammering the upstream on every request.
  private static readonly EMPTY_TTL = 30;

  private static isEmptyResult(result: unknown): boolean {
    if (Array.isArray(result)) return result.length === 0;
    return !result;
  }

  constructor(db: Database, redis: Redis) {
    super("web", db);
    this.db = db;
    this.redis = redis;
    this.ready = true;
  }

  async close() {
    await this.redis.close();
    await this.db.close?.();
    this.ready = false;
  }

  private ensureReady() {
    if (!this.ready) {
      throw new Error("WebPlatformHandler not initialized. Call init() first.");
    }
  }

  // How long past its TTL a listing is still served (stale) while a fresh copy
  // is fetched in the background. A cold scrape costs 2–8s per request; past
  // the TTL every visitor used to pay it again, which is what made browsing
  // feel slow. Now only the very first visitor (or one after a day idle) waits.
  private static readonly STALE_WINDOW = 60 * 60 * 24;

  /** In-process single-flight: concurrent misses on one key share one scrape. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private fetchAndStore<T>(
    key: string,
    ttl: number,
    fn: () => Promise<T>,
    isEmpty: (result: T) => boolean,
    staleWindow: number
  ): Promise<T> {
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const run = (async () => {
      const result = await fn();
      const empty = isEmpty(result);
      const freshFor = empty ? WebPlatformHandler.EMPTY_TTL : ttl;
      // An empty result is never kept around stale: it must self-heal fast.
      const keepFor = freshFor + (empty ? 0 : staleWindow);
      await this.redis
        .set(key, { v: result, exp: Date.now() + freshFor * 1000 }, keepFor)
        .catch(() => {});
      return result;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, run);
    return run;
  }

  /**
   * Cache-aside with stale-while-revalidate. `staleWindow` 0 means a hard
   * TTL — required for anything carrying signed, expiring URLs (servers,
   * resolved video), where a stale answer is a broken one.
   */
  private async withCache<T>(
    key: string,
    ttl: number,
    fn: () => Promise<T>,
    isEmpty: (result: T) => boolean = WebPlatformHandler.isEmptyResult,
    skipCache = false,
    staleWindow = WebPlatformHandler.STALE_WINDOW
  ): Promise<T> {
    if (!skipCache) {
      const cached = await this.redis.get<any>(key).catch(() => null);
      if (cached !== null && cached !== undefined) {
        // Entries written before the envelope existed: plain value, own TTL.
        if (typeof cached !== "object" || !("exp" in cached) || !("v" in cached)) {
          return cached as T;
        }
        if (Date.now() >= cached.exp) {
          // Stale: answer now, refresh behind it. A failed refresh keeps the
          // stale copy, which beats an error for a listing.
          this.fetchAndStore(key, ttl, fn, isEmpty, staleWindow).catch((err) =>
            console.warn("[cache] background refresh failed", key, String(err?.message ?? err))
          );
        }
        return cached.v as T;
      }
    }

    return this.fetchAndStore(key, ttl, fn, isEmpty, staleWindow);
  }

  /**
   * Deletes every cache entry for one provider. Cache keys always carry the
   * provider slug as their second segment (see the `key` construction in
   * each method below), never as a leading, single greppable prefix, so this
   * has to cover each endpoint's own pattern rather than one SCAN.
   */
  async clearProviderCache(providerName: string): Promise<number> {
    this.ensureReady();
    const patterns = [
      `home:${providerName}`,
      `search:${providerName}:*`,
      `show:${providerName}:*`,
      `episodes:${providerName}:*`,
      `servers:${providerName}:*`,
      `genres:${providerName}`,
      `genre:${providerName}:*`,
      `video:${providerName}:*`,
    ];
    let total = 0;
    for (const pattern of patterns) {
      total += await this.redis.deleteByPattern(pattern);
    }
    return total;
  }

  override async getHome(providerName: string) {
    this.ensureReady();

    const key = `home:${providerName}`;
    return this.withCache(key, WebPlatformHandler.TTL.HOME, () =>
      this.core.getHome(providerName)
    );
  }

  override async search(providerName: string, query: string, page?: number) {
    this.ensureReady();

    const key = `search:${providerName}:${query}:${page ?? 1}`;
    const result = await this.withCache(key, WebPlatformHandler.TTL.SEARCH, () =>
      this.core.search(providerName, query, page)
    );

    await this.db
      .query(
        `INSERT INTO search_logs (provider, query, page) VALUES ($1, $2, $3)`,
        [providerName, query, page ?? 1]
      )
      .catch(() => {});

    return result;
  }

  override async getShowDetails(providerName: string, showId: string) {
    this.ensureReady();

    const key = `show:${providerName}:${showId}`;
    return this.withCache(key, WebPlatformHandler.TTL.SHOW_DETAILS, () =>
      this.core.getShowDetails(providerName, showId)
    );
  }

  override async getEpisodes(providerName: string, seasonId: string) {
    this.ensureReady();

    const key = `episodes:${providerName}:${seasonId}`;
    return this.withCache(key, WebPlatformHandler.TTL.EPISODES, () =>
      this.core.getEpisodes(providerName, seasonId)
    );
  }

  override async getServers(
    providerName: string,
    episodeId: string,
    contentType?: "episode" | "movie"
  ) {
    this.ensureReady();

    const key = `servers:${providerName}:${episodeId}:${contentType ?? "episode"}`;
    // Server entries carry signed embed tokens: never served stale.
    return this.withCache(
      key,
      WebPlatformHandler.TTL.SERVERS,
      () => this.core.getServers(providerName, episodeId, contentType),
      WebPlatformHandler.isEmptyResult,
      false,
      0
    );
  }

  async getGenres(providerName: string) {
    this.ensureReady();

    const key = `genres:${providerName}`;
    return this.withCache(key, WebPlatformHandler.TTL.GENRES, () =>
      this.core.getGenres(providerName)
    );
  }

  supportsGenres(providerName: string) {
    return this.core.supportsGenres(providerName);
  }

  // Not cached: a pure parse of the id, no upstream call behind it.
  showIdForPlayableId(providerName: string, playableId: string) {
    return this.core.showIdForPlayableId(providerName, playableId);
  }

  async getGenre(providerName: string, genreId: string, page?: number) {
    this.ensureReady();

    const key = `genre:${providerName}:${genreId}:${page ?? 1}`;
    // Genre is a single object ({..., shows: Show[]}), always truthy, so the
    // default array/falsy predicate would never flag an empty page as empty.
    return this.withCache(
      key,
      WebPlatformHandler.TTL.GENRE,
      () => this.core.getGenre(providerName, genreId, page),
      (r: Genre) => !r || !r.shows?.length
    );
  }

  // `fresh` skips the cached URL entirely — used when a client already tried
  // the cached resolve and it played back a broken/wrong stream: a plain
  // retry within the TTL window would just hand back the same bad cached
  // URL, so the client has to ask for a re-resolve explicitly.
  async resolveVideo(providerName: string, server: any, fresh = false) {
    this.ensureReady();

    const serverKey = typeof server === "object"
      ? JSON.stringify(server)
      : String(server);
    const key = `video:${providerName}:${Buffer.from(serverKey).toString("base64")}`;

    return this.withCache(
      key,
      WebPlatformHandler.TTL.VIDEO,
      () => this.core.resolveVideo(providerName, server),
      WebPlatformHandler.isEmptyResult,
      fresh,
      0
    );
  }
}