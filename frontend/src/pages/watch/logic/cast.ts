/**
 * The Cast LOAD payload — buildCastCustomData / castSubtitleList /
 * castProxyUrl and the contentType choice in public/scripts/watch.js.
 *
 * `customData` is a contract shared with the Flutter client and the receiver
 * (cast-receiver's docs/protocol.md). The receiver degrades field by field,
 * so every field is optional to it: adding one is always safe, removing or
 * renaming one needs coordination.
 */
import type { SubtitleSource } from "./stream";

/**
 * Lowercase, always: CAF picks its playback pipeline by looking the content
 * type up case-sensitively, and "application/x-mpegURL" lands on the plain
 * media element, fails ~13s in as error 100 and poisons that receiver page.
 */
export const CONTENT_TYPE_HLS = "application/x-mpegurl";

/** The receiver's control namespace (EPISODE_CHANGED, STATE, …). */
export const CAST_NS = "urn:x-cast:com.streamio.control";

/**
 * The shared receiver, used when /api/cast-config can't be read. Safe to
 * hard-code: that deployment is told its API base per LOAD, so one receiver
 * serves every install. Same default as CAST_RECEIVER_APP_ID's on the server.
 */
export const STREAMIO_RECEIVER_APP_ID = "BF64D6B2";

/** Everything about the current stream frozen at resolve time. */
export interface CastMedia {
  url: string;
  title: string;
  subtitles: SubtitleSource[];
  type: string;
  /** The Referer override the local player also uses, when the resolver asked for one. */
  referer: string;
  serverName: string;
  serverIndex: number;
}

export interface CastSubtitle {
  label: string;
  lang: string;
  url: string;
  default: boolean;
}

export interface CastEpisodeRef {
  id: string;
  s: number | string;
  e: number | string;
  t?: string | null;
}

export interface CastCustomData {
  v?: number;
  apiBase?: string;
  castProxyBase?: string | null;
  provider?: string;
  contentType?: "episode" | "movie";
  showId?: string;
  tmdbId?: number | null;
  imdbId?: string;
  year?: number | null;
  showTitle?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  seasonId?: string;
  seasonNumber?: number | null;
  episodeId?: string;
  episodeNumber?: number | null;
  episodeTitle?: string;
  episodeLabel?: string;
  durationSeconds?: number | null;
  serverName?: string;
  serverIndex?: number;
  subtitles?: CastSubtitle[];
  episodes?: CastEpisodeRef[];
  episodeIndex?: number;
  autoplayNext?: boolean;
  upNextSeconds?: number;
}

/**
 * The receiver's proxy URL for `rawUrl`, with the stream's Referer override
 * folded in. `proxyBase` ends in "url=", so the extra param goes ahead of it.
 */
export function castProxyUrl(proxyBase: string, rawUrl: string, referer: string): string {
  const ref = referer ? "ref=" + encodeURIComponent(referer) + "&" : "";
  return proxyBase.replace(/url=$/, ref + "url=") + encodeURIComponent(rawUrl);
}

/**
 * Subtitle URLs go through /api/cast-proxy too: upstream VTT is often plain
 * http (mixed content on an https receiver) with no CORS header, either of
 * which makes CAF drop the track silently.
 */
export function castSubtitleList(media: CastMedia | null, proxyBase: string): CastSubtitle[] {
  const subs = media?.subtitles || [];
  return subs
    .map((s): CastSubtitle | null => {
      const raw = s.url || s.file || s.src || "";
      if (!raw) return null;
      return {
        label: s.label || s.lang || "Subtitle",
        lang: s.lang || "und",
        url: castProxyUrl(proxyBase, raw, media?.referer || ""),
        default: !!(s.default || s.initialDefault),
      };
    })
    .filter((s): s is CastSubtitle => s !== null);
}

/** The MediaInfo content type: the stream's own for a progressive file, HLS otherwise. */
export function castContentType(media: Pick<CastMedia, "type">): string {
  const progressive = /^video\//i.test(media.type || "");
  return progressive ? String(media.type || "video/mp4").toLowerCase() : CONTENT_TYPE_HLS;
}

export function isProgressiveCast(media: Pick<CastMedia, "type">): boolean {
  return /^video\//i.test(media.type || "");
}

/** What buildCastCustomData reads off the page, gathered by the caller. */
export interface CastContext {
  apiBase: string;
  proxyBase: string;
  provider: string;
  playbackType: "episode" | "movie";
  playbackId: string;
  showId: string;
  show: {
    title?: string | null;
    overview?: string | null;
    poster?: string | null;
    banner?: string | null;
    runtime?: number | null;
  } | null;
  introIds: { tmdbId: number | null; imdbId: string; year: number | null };
  episodes: readonly { id: string; seasonNum: number | string; episodeNum: number | string; title?: string | null }[];
  episodeIndex: number;
  episodeLabel: string;
  /** The local element's duration. */
  duration: number;
  serverName: string;
  serverIndex: number;
  autoplayNext: boolean;
  upNextSeconds: number;
  media: CastMedia | null;
}

/**
 * Everything the receiver needs to draw a real UI, keep playing after this
 * tab closes, and re-resolve an expired stream. Built at LOAD time from the
 * live page, so it describes the episode actually being cast.
 */
export function buildCastCustomData(c: CastContext): CastCustomData {
  const isEpisode = c.playbackType === "episode";
  const show = c.show || {};
  const current = c.episodes[c.episodeIndex];
  return {
    v: 1,
    apiBase: c.apiBase,
    castProxyBase: c.proxyBase,
    provider: c.provider,
    contentType: c.playbackType,

    showId: c.showId,
    tmdbId: c.introIds.tmdbId,
    imdbId: c.introIds.imdbId,
    year: c.introIds.year,
    showTitle: show.title || c.media?.title || "Streamio",
    description: show.overview || "",
    poster: show.poster || "",
    backdrop: show.banner || show.poster || "",

    seasonId: "",
    seasonNumber: isEpisode ? Number(current?.seasonNum) || null : null,
    episodeId: isEpisode ? c.playbackId : "",
    episodeNumber: isEpisode ? Number(current?.episodeNum) || null : null,
    episodeTitle: isEpisode ? current?.title || "" : "",
    episodeLabel: isEpisode ? c.episodeLabel : "",
    durationSeconds: Number.isFinite(c.duration) ? Math.floor(c.duration) : show.runtime ? show.runtime * 60 : null,

    serverName: c.media?.serverName || c.serverName,
    serverIndex: c.media?.serverIndex ?? c.serverIndex,

    subtitles: castSubtitleList(c.media, c.proxyBase),

    // Ids only, ~40 bytes each — a 300-episode show stays well inside the
    // message budget. The receiver fetches the list itself when it's absent.
    episodes: c.episodes.slice(0, 500).map((ep) => ({ id: ep.id, s: ep.seasonNum, e: ep.episodeNum, t: ep.title })),
    episodeIndex: c.episodeIndex,
    autoplayNext: c.autoplayNext,
    upNextSeconds: c.upNextSeconds,
  };
}
