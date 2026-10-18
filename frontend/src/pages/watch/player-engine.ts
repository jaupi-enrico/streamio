/**
 * The media element and the hls.js instance driving it — the mechanical half
 * of playResolvedStream / cleanupPlayer / addSubtitleTrack in
 * public/scripts/watch.js. Deciding *what* to play (which episode, which
 * server, when to retry) is WatchSession's job; this only loads what it's
 * handed and reports back.
 *
 * hls.js comes from npm now (same 1.6 line the vanilla page loads from the
 * CDN), bundled into the watch page's own chunk.
 */
import Hls, { type HlsConfig } from "hls.js";
import { isProgressiveSource, playableSource, safeRequestHeaders, type StreamPayload, type SubtitleSource } from "./logic/stream";

export interface EngineHooks {
  /** hls.js parsed the manifest: levels and menus exist, playback can start. */
  onManifestParsed(): void;
  /** Native/progressive path: metadata is in, the element knows its tracks. */
  onMetadata(): void;
  /** hls.js gave up on the stream. */
  onFatal(): void;
  onLevelsUpdated(): void;
  onLevelSwitched(): void;
  onSubtitleTracksUpdated(): void;
}

export type LoadResult = "none" | "progressive" | "hls" | "native" | "unsupported";

/**
 * Tuned for the proxy hop, not a direct CDN: every fragment travels browser →
 * reverse proxy → server → upstream, and /api/cast-proxy can't send a byte
 * before the upstream answers, so time-to-first-byte is the sum of that chain.
 * The default ~10s budget expired against a merely sluggish upstream (four
 * fragLoadTimeOuts with `loaded: 0`, fatal, retry, same congested path).
 * lowLatencyMode stays off: an LL-HLS setting that buys nothing on VOD and
 * biases toward smaller buffers.
 */
function hlsConfig(headers: Record<string, string>): Partial<HlsConfig> {
  // The vanilla page also passed `subtitleDisplay` here. hls.js has no such
  // option — it is an instance property, default true — so it was a no-op;
  // the subtitles preference takes effect through `subtitleTrack = -1`.
  return {
    enableWorker: true,
    // A deeper cushion (default 30s) absorbs one slow fragment.
    maxBufferLength: 60,
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 30000,
        maxLoadTimeMs: 120000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      },
    },
    // AES keys go through the same proxy; a key that times out makes every
    // buffered fragment undecryptable, so it gets the same budget.
    keyLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 30000,
        maxLoadTimeMs: 120000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 8, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      },
    },
    xhrSetup: (xhr) => {
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    },
  };
}

export class PlayerEngine {
  readonly video: HTMLVideoElement;
  hls: Hls | null = null;
  /** The URL last handed to the element or hls.js — what Download reads. */
  videoUrl = "";
  private blobUrl = "";

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** Stops and empties the element, and drops the hls.js instance. */
  cleanup(): void {
    this.clearSubtitleTracks();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = "";
    }
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
  }

  /** The URL a payload plays from; inline manifests become a blob: URL this engine owns. */
  playableUrl(stream: StreamPayload): string {
    const src = playableSource(stream);
    if (src.kind === "none") return "";
    if (src.kind === "url") return src.url;
    const blob = new Blob([src.text], { type: "application/vnd.apple.mpegurl" });
    this.blobUrl = URL.createObjectURL(blob);
    return this.blobUrl;
  }

  clearSubtitleTracks(): void {
    [...this.video.querySelectorAll("track")].forEach((t) => t.remove());
  }

  /**
   * <track> children appended imperatively: React renders the <video> with no
   * children, so it never reconciles over these.
   */
  addSubtitleTrack(sub: SubtitleSource, isDefault = false): void {
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = sub.label || sub.lang || "Subtitle";
    track.srclang = sub.lang || "en";
    track.src = sub.url || sub.file || sub.src || "";
    if (isDefault) track.default = true;
    this.video.appendChild(track);
  }

  /**
   * Loads `url` the way the vanilla page did: a progressive file straight
   * into the element, HLS through hls.js where it's supported, the element's
   * own HLS (Safari) otherwise.
   */
  load(url: string, stream: StreamPayload, hooks: EngineHooks): LoadResult {
    const player = this.video;

    if (isProgressiveSource(url, stream?.type)) {
      player.src = url;
      player.play().catch(() => {});
      player.addEventListener("loadedmetadata", () => hooks.onMetadata(), { once: true });
      return "progressive";
    }

    if (Hls.isSupported()) {
      const hls = new Hls(hlsConfig(safeRequestHeaders(stream)));
      this.hls = hls;
      hls.loadSource(url);
      hls.attachMedia(player);
      hls.on(Hls.Events.MANIFEST_PARSED, () => hooks.onManifestParsed());
      // Levels can be pruned after a load error, and the Auto row shows the
      // rendition ABR settled on — both need the menu redrawn.
      hls.on(Hls.Events.LEVEL_SWITCHED, () => hooks.onLevelSwitched());
      hls.on(Hls.Events.LEVELS_UPDATED, () => hooks.onLevelsUpdated());
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => hooks.onSubtitleTracksUpdated());
      hls.on(Hls.Events.ERROR, (_e, d) => {
        console.error("HLS error", d);
        if (d.fatal) hooks.onFatal();
      });
      return "hls";
    }

    if (player.canPlayType("application/vnd.apple.mpegurl")) {
      player.src = url;
      player.play().catch(() => {});
      player.addEventListener("loadedmetadata", () => hooks.onMetadata(), { once: true });
      return "native";
    }

    return "unsupported";
  }

  destroy(): void {
    this.cleanup();
  }
}
