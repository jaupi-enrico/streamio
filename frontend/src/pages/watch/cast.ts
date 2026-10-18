/**
 * Google Cast — the CAF sender half of public/scripts/watch.js (initCast,
 * the session lifecycle, loadCastMedia, the receiver channel, progress while
 * casting and the control panel).
 *
 * The TV plays the raw upstream URL through /api/cast-proxy, which rewrites
 * every nested manifest URI back through itself. The receiver is told the
 * proxy base and the API base in customData on every LOAD — one receiver
 * deployment serves every install.
 *
 * The SDK is a document-wide singleton (cast-sdk.ts); this controller is per
 * page mount and removes every listener it added when disposed. A cast
 * session outlives the page, as it outlived the vanilla tab.
 */
import { apiUrl } from "../../lib/base";
import { getSelectedProvider } from "../../lib/provider-selection";
import type { EpisodeCard } from "./logic/episodes";
import {
  CAST_NS,
  STREAMIO_RECEIVER_APP_ID,
  buildCastCustomData,
  castContentType,
  castProxyUrl,
  isProgressiveCast,
  type CastCustomData,
  type CastMedia,
  type CastSubtitle,
} from "./logic/cast";
import { NEXT_EP_THRESHOLD, formatTime } from "./logic/playback";
import { rawSourceOf, readRefererHeader, type StreamPayload } from "./logic/stream";
import {
  configureCastContext,
  loadCastSdk,
  type CastContextApi,
  type CastFramework,
  type CastSessionApi,
  type ChromeCastApi,
  type RemotePlayer,
  type RemotePlayerController,
} from "./cast-sdk";
import type { IntroDbIds } from "./upnext";
import { Store } from "./store";

/** What Cast needs from the page's session. */
export interface CastHost {
  readonly player: HTMLVideoElement;
  readonly container: HTMLElement | null;
  readonly showId: string;
  readonly show: {
    title?: string | null;
    overview?: string | null;
    poster?: string | null;
    banner?: string | null;
    runtime?: number | null;
  } | null;
  readonly playbackId: string;
  readonly playbackType: "episode" | "movie";
  readonly episodeLabel: string;
  readonly episodes: readonly EpisodeCard[];
  readonly episodeIndex: number;
  readonly serverName: string;
  readonly serverIndex: number;
  readonly introIds: IntroDbIds;
  /** The page title as shown (the vanilla page read #contentTitle). */
  readonly heading: string;
  readonly inRoom: boolean;
  autoplayNextEnabled: boolean;
  showPlayerMessage(msg: string): void;
  saveProgress(
    completed: boolean,
    override: {
      positionSeconds: number;
      durationSeconds: number;
      playbackId: string;
      episodeLabel: string;
      contentType: "episode" | "movie";
    },
  ): void;
  /** The receiver advanced on its own; the page follows. */
  onReceiverEpisode(episodeId: string, label: string): void;
  roomToast(msg: string): void;
}

/** A STATE message from the receiver — every field advisory. */
interface ReceiverState {
  type: "STATE";
  showTitle?: string;
  episodeLabel?: string;
  episodeTitle?: string;
  skipSegment?: { label?: string } | null;
  subtitleTracks?: { id: number; name?: string; lang?: string }[];
  activeTrackId?: number | null;
  audioTracks?: { id: number; name?: string; lang?: string }[];
  activeAudioTrackId?: number;
}

interface ReceiverMessage {
  type?: string;
  episodeId?: string;
  episodeLabel?: string;
  message?: string;
}

export interface CastOption {
  value: string;
  label: string;
}

/** What renderCastPanel wrote, computed when it would have run. */
export interface CastPanelView {
  deviceTitle: string;
  title: string;
  sub: string;
  poster: string;
  fill: string;
  elapsed: string;
  duration: string;
  paused: boolean;
  muted: boolean;
  volume: number;
  autoplayNext: boolean;
  skipLabel: string | null;
  episodes: CastOption[];
  episodeIndex: number;
  subtitles: CastOption[];
  activeTrackId: number | null;
  audio: CastOption[];
  activeAudioTrackId: number | null;
}

export interface CastSnapshot {
  /** The button's inline display: hidden until a device is seen. */
  buttonDisplay: "none" | "flex";
  connected: boolean;
  panelOpen: boolean;
  /** Null until the panel was first rendered — the markup's own text shows. */
  view: CastPanelView | null;
}

export class CastController {
  readonly store = new Store<CastSnapshot>({ buttonDisplay: "none", connected: false, panelOpen: false, view: null });

  private disposed = false;
  private cleanups: (() => void)[] = [];
  private framework: CastFramework | null = null;
  private chromeCast: ChromeCastApi | null = null;
  private context: CastContextApi | null = null;
  private session: CastSessionApi | null = null;
  private remotePlayer: RemotePlayer | null = null;
  private remoteController: RemotePlayerController | null = null;
  private proxyBase: string | null = null;
  private apiBase: string | null = null;

  private media: CastMedia | null = null;
  isCasting = false;
  private deviceName = "";
  private progressTimer: ReturnType<typeof setInterval> | undefined;
  // What's on the TV. Diverges from the page's own playback once the
  // receiver advances by itself — which is why history is written against these.
  private castEpisodeId = "";
  private castEpisodeLabel = "";
  private castContentType: "episode" | "movie" = "episode";
  private remoteState: ReceiverState | null = null;

  constructor(private readonly host: CastHost) {}

  dispose(): void {
    if (this.disposed) return;
    // Leaving the page doesn't stop the TV; history just stops advancing, as
    // when the vanilla tab closed.
    this.saveCastProgress(false);
    this.disposed = true;
    this.stopProgressTimer();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.store.close();
  }

  // ── Setup ──

  async init(): Promise<void> {
    const available = await loadCastSdk();
    if (!available || this.disposed) return;
    const framework = window.cast?.framework;
    const chromeCast = window.chrome?.cast;
    if (!framework || !chromeCast) return;

    let receiverAppId: string | null = null;
    try {
      const res = await fetch(apiUrl("/api/cast-config"));
      const data = (await res.json()) as { castProxyBase?: string; castReceiverAppId?: string };
      this.proxyBase = data.castProxyBase ?? null;
      receiverAppId = data.castReceiverAppId ?? null;
      // The receiver has no page origin to resolve relative URLs against.
      this.apiBase = String(this.proxyBase || "").split("/api/cast-proxy")[0] ?? "";
    } catch (err) {
      console.error("[cast] failed to fetch cast config:", err);
    }
    if (this.disposed) return;

    this.framework = framework;
    this.chromeCast = chromeCast;
    const context = framework.CastContext.getInstance();
    this.context = context;
    configureCastContext(context, {
      // Never the default media receiver: it mishandles the demuxed
      // audio/video HLS these sources emit.
      receiverApplicationId: receiverAppId || STREAMIO_RECEIVER_APP_ID,
      autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
      resumeSavedSession: true,
    });

    const onCastState = (e: { castState?: string }): void => this.reflectCastState(e.castState || "");
    context.addEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, onCastState);
    this.cleanups.push(() => context.removeEventListener(framework.CastContextEventType.CAST_STATE_CHANGED, onCastState));
    this.reflectCastState(context.getCastState());

    const S = framework.SessionState;
    const onSessionState = (e: { sessionState?: string }): void => {
      if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
        this.onSessionStarted(context.getCurrentSession());
      } else if (e.sessionState === S.SESSION_ENDED) {
        this.onSessionEnded();
      }
    };
    context.addEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, onSessionState);
    this.cleanups.push(() =>
      context.removeEventListener(framework.CastContextEventType.SESSION_STATE_CHANGED, onSessionState),
    );

    this.setupRemotePlayer(framework);

    // A session carried over from an earlier watch page in this document:
    // the SDK announced it to that page, so this one picks it up itself (a
    // full page load gets SESSION_RESUMED instead).
    const state = context.getSessionState();
    if (state === S.SESSION_STARTED || state === S.SESSION_RESUMED) this.onSessionStarted(context.getCurrentSession());
  }

  private reflectCastState(state: string): void {
    const CS = this.framework?.CastState;
    if (!CS) return;
    this.store.set({
      buttonDisplay: state === CS.NO_DEVICES_AVAILABLE ? "none" : "flex",
      connected: state === CS.CONNECTED,
    });
  }

  private setupRemotePlayer(framework: CastFramework): void {
    const remotePlayer = new framework.RemotePlayer();
    const controller = new framework.RemotePlayerController(remotePlayer);
    this.remotePlayer = remotePlayer;
    this.remoteController = controller;
    const E = framework.RemotePlayerEventType;
    const render = (): void => this.render();
    for (const evt of [
      E.IS_CONNECTED_CHANGED,
      E.CURRENT_TIME_CHANGED,
      E.DURATION_CHANGED,
      E.IS_PAUSED_CHANGED,
      E.VOLUME_LEVEL_CHANGED,
      E.IS_MUTED_CHANGED,
      E.MEDIA_INFO_CHANGED,
      E.PLAYER_STATE_CHANGED,
    ]) {
      controller.addEventListener(evt, render);
      this.cleanups.push(() => controller.removeEventListener(evt, render));
    }
  }

  /**
   * The stream now in the player. Cast needs a publicly reachable http(s)
   * URL; a blob:/data: manifest is local only and disables casting.
   */
  setMedia(stream: StreamPayload | null): void {
    const raw = rawSourceOf(stream);
    this.media = raw.startsWith("http")
      ? {
          url: raw,
          title: this.host.heading.trim() || "Streamio",
          subtitles: stream?.subtitles || stream?.captions || [],
          type: stream?.type || "",
          referer: readRefererHeader(stream),
          serverName: this.host.serverName,
          serverIndex: this.host.serverIndex,
        }
      : null;
  }

  /**
   * Casting already: an episode/server change made on the page belongs on
   * the TV. True when it was sent there instead of the local player.
   */
  playOnReceiver(): boolean {
    if (!this.isCasting) return false;
    const session = this.context?.getCurrentSession();
    if (!session) return false;
    this.loadMedia(session);
    this.host.showPlayerMessage(`Playing on ${this.deviceName || "your TV"}`);
    return true;
  }

  // ── The button ──

  onButtonClick(): void {
    // Connected: the button opens the panel instead of reloading the stream.
    if (this.isCasting) {
      this.togglePanel();
      return;
    }
    if (!this.media) {
      alert("Select a server and start playback before casting.");
      return;
    }
    const context = this.context;
    if (!context) return;
    const session = context.getCurrentSession();
    if (session) {
      this.onSessionStarted(session);
      return;
    }
    // requestSession must be the first async call in the click handler or the
    // browser blocks the Presentation API. Picking a device fires
    // SESSION_STARTED, handled above.
    context.requestSession().catch((err: unknown) => {
      if (err !== "cancel") console.error("[cast] requestSession failed:", err);
    });
  }

  // ── Session lifecycle ──

  private onSessionStarted(session: CastSessionApi | null): void {
    if (!session || this.disposed) return;
    const previous = this.session;
    this.session = session;
    this.isCasting = true;
    this.deviceName = session.getCastDevice()?.friendlyName || "your TV";

    // The page becomes a remote: two copies of one stream aren't pulled at once.
    this.host.player.pause();
    this.host.container?.classList.add("casting");

    if (previous !== session) {
      const listener = (_ns: string, message: string): void => {
        let payload: unknown;
        try {
          payload = typeof message === "string" ? JSON.parse(message) : message;
        } catch {
          return;
        }
        this.onReceiverMessage(payload);
      };
      session.addMessageListener(CAST_NS, listener);
      this.cleanups.push(() => session.removeMessageListener(CAST_NS, listener));
    }

    this.loadMedia(session);
    this.send({ type: "HELLO", v: 1 });
    this.openPanel();
    this.startProgressTimer();
    if (this.host.inRoom) this.host.roomToast("Watch party sync pauses while casting");
  }

  private onSessionEnded(): void {
    if (!this.isCasting) return;
    this.saveCastProgress(false);
    this.stopProgressTimer();
    this.isCasting = false;
    this.session = null;
    this.remoteState = null;
    this.host.container?.classList.remove("casting");
    this.store.set({ panelOpen: false });

    // The position comes back to the local player, which stays paused —
    // nobody wants audio suddenly coming out of the laptop.
    const player = this.host.player;
    const pos = this.remotePlayer?.currentTime;
    if (pos !== undefined && Number.isFinite(pos) && pos > 0 && player.readyState > 0) player.currentTime = pos;
    this.host.showPlayerMessage("Casting stopped");
  }

  // ── Load ──

  private customData(): CastCustomData {
    const host = this.host;
    return buildCastCustomData({
      apiBase: this.apiBase || location.origin,
      proxyBase: this.proxyBase || "",
      provider: getSelectedProvider(),
      playbackType: host.playbackType,
      playbackId: host.playbackId,
      showId: new URLSearchParams(window.location.search).get("id") || "",
      show: host.show,
      introIds: host.introIds,
      episodes: host.episodes,
      episodeIndex: host.episodeIndex,
      episodeLabel: host.episodeLabel,
      duration: host.player.duration,
      serverName: host.serverName,
      serverIndex: host.serverIndex,
      autoplayNext: host.autoplayNextEnabled,
      upNextSeconds: NEXT_EP_THRESHOLD,
      media: this.media,
    });
  }

  private buildTracks(subs: CastSubtitle[]): Record<string, unknown>[] {
    const media = this.chromeCast!.media;
    return subs.map((s, i) => {
      // Track ids are positive integers — 0 isn't a valid activeTrackId.
      const t = new media.Track(i + 1, media.TrackType.TEXT);
      t.trackContentId = s.url;
      t.trackContentType = "text/vtt";
      t.subtype = media.TextTrackType.SUBTITLES;
      t.name = s.label;
      t.language = s.lang;
      return t;
    });
  }

  /**
   * The receiver draws its own UI, but MediaInformation.metadata is what
   * Google Assistant and the phone's media notification read.
   */
  private buildMetadata(d: CastCustomData): Record<string, unknown> {
    const chromeCast = this.chromeCast!;
    const images: Record<string, unknown>[] = [];
    const art = d.poster || d.backdrop;
    if (art) images.push(new chromeCast.Image(art));

    if (d.contentType === "episode") {
      const md = new chromeCast.media.TvShowMediaMetadata();
      md.seriesTitle = d.showTitle;
      md.title = d.episodeTitle || d.episodeLabel || d.showTitle;
      if (d.seasonNumber) md.season = d.seasonNumber;
      if (d.episodeNumber) md.episode = d.episodeNumber;
      if (images.length) md.images = images;
      return md;
    }
    const md = new chromeCast.media.MovieMediaMetadata();
    md.title = d.showTitle;
    if (d.description) md.subtitle = d.description.slice(0, 120);
    if (images.length) md.images = images;
    return md;
  }

  private loadMedia(session: CastSessionApi): void {
    const media = this.media;
    if (!media || !this.proxyBase || !this.chromeCast) return;
    const cm = this.chromeCast.media;

    const customData = this.customData();
    const proxied = castProxyUrl(this.proxyBase, media.url, media.referer);
    const progressive = isProgressiveCast(media);
    const mediaInfo = new cm.MediaInfo(proxied, castContentType(media));
    mediaInfo.streamType = cm.StreamType.BUFFERED;
    mediaInfo.metadata = this.buildMetadata(customData);

    const tracks = this.buildTracks(customData.subtitles || []);
    if (tracks.length) mediaInfo.tracks = tracks;

    // A demuxed stream can't be auto-detected by the device and fails with
    // error 315 without the segment formats. Sent here as well as set by the
    // receiver, in case a device runs a cached receiver.
    if (!progressive) {
      mediaInfo.hlsSegmentFormat = cm.HlsSegmentFormat?.TS;
      mediaInfo.hlsVideoSegmentFormat = cm.HlsVideoSegmentFormat?.MPEG2_TS;
    }
    mediaInfo.customData = customData;

    const request = new cm.LoadRequest(mediaInfo);
    const localTime = this.host.player.currentTime;
    request.currentTime = Number.isFinite(localTime) && localTime > 0 ? Math.floor(localTime) : 0;
    request.autoplay = true;
    request.customData = customData;

    const defaultTrack = (customData.subtitles || []).findIndex((s) => s.default);
    if (defaultTrack !== -1) request.activeTrackIds = [defaultTrack + 1];

    this.castEpisodeId = customData.episodeId || customData.showId || "";
    this.castEpisodeLabel = customData.episodeLabel || "";
    this.castContentType = customData.contentType || "episode";

    session.loadMedia(request).then(
      () => {
        console.log("[cast] loadMedia OK");
        this.render();
      },
      (err: unknown) => console.error("[cast] loadMedia error:", err),
    );
  }

  // ── Receiver channel ──

  send(payload: Record<string, unknown>): void {
    if (!this.session) return;
    try {
      void this.session.sendMessage(CAST_NS, payload);
    } catch (err) {
      console.warn("[cast] sendMessage failed", err);
    }
  }

  /** Every message is advisory: a device may run an older receiver that sends none. */
  private onReceiverMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object" || this.disposed) return;
    const payload = raw as ReceiverMessage;

    if (payload.type === "STATE") {
      this.remoteState = raw as ReceiverState;
      this.render();
      return;
    }
    if (payload.type === "EPISODE_CHANGED") {
      // The receiver advanced by itself: close out the episode it finished,
      // then point history at the new one.
      this.saveCastProgress(true);
      this.castEpisodeId = payload.episodeId || this.castEpisodeId;
      this.castEpisodeLabel = payload.episodeLabel || "";
      this.castContentType = "episode";
      if (payload.episodeId) this.host.onReceiverEpisode(payload.episodeId, this.castEpisodeLabel);
      this.render();
      return;
    }
    if (payload.type === "RECOVERING") {
      this.host.showPlayerMessage(`Reconnecting the stream on ${this.deviceName}…`);
      return;
    }
    if (payload.type === "ERROR") {
      this.host.showPlayerMessage(`Cast error: ${payload.message || "playback failed"}`);
    }
  }

  // ── Progress while casting ──
  // Only while the page is open: the receiver has no access token and can't
  // write history itself.

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = setInterval(() => {
      if (!this.isCasting || !this.remotePlayer || this.remotePlayer.isPaused) return;
      this.saveCastProgress(false);
    }, 30_000);
  }

  private stopProgressTimer(): void {
    clearInterval(this.progressTimer);
    this.progressTimer = undefined;
  }

  saveCastProgress(completed: boolean): void {
    if (!this.isCasting || !this.remotePlayer || this.disposed) return;
    this.host.saveProgress(completed, {
      positionSeconds: this.remotePlayer.currentTime,
      durationSeconds: this.remotePlayer.duration,
      playbackId: this.castEpisodeId,
      episodeLabel: this.castEpisodeLabel,
      contentType: this.castContentType,
    });
  }

  // ── Panel actions ──

  playOrPause(): void {
    this.remoteController?.playOrPause();
  }

  muteOrUnmute(): void {
    this.remoteController?.muteOrUnmute();
  }

  setVolume(level: number): void {
    if (!this.remotePlayer) return;
    this.remotePlayer.volumeLevel = level;
    this.remoteController!.setVolumeLevel();
  }

  seekToFraction(fraction: number): void {
    if (!this.remotePlayer || !this.remotePlayer.duration) return;
    this.remotePlayer.currentTime = fraction * this.remotePlayer.duration;
    this.remoteController!.seek();
  }

  /**
   * Off the RemotePlayer's own clock, not the last STATE: that is broadcast
   * every 5s, and a stale position would skip by up to fifteen seconds.
   */
  seekBy(seconds: number): void {
    const rp = this.remotePlayer;
    if (!rp || !this.remoteController || !rp.duration) return;
    const target = (rp.currentTime || 0) + seconds;
    rp.currentTime = Math.max(0, Math.min(target, rp.duration));
    this.remoteController.seek();
  }

  previousEpisode(): void {
    this.send({ type: "PLAY_EPISODE", index: this.host.episodeIndex - 1 });
  }

  nextEpisode(): void {
    this.send({ type: "PLAY_NEXT_NOW" });
  }

  skipSegment(): void {
    this.send({ type: "SKIP_SEGMENT_NOW" });
  }

  setAutoplay(enabled: boolean): void {
    this.host.autoplayNextEnabled = enabled;
    this.send({ type: "SET_AUTOPLAY", enabled });
  }

  playEpisode(index: number): void {
    if (Number.isFinite(index) && index >= 0) this.send({ type: "PLAY_EPISODE", index });
  }

  setSubtitle(trackId: number): void {
    this.send({ type: "SET_SUBTITLE", trackId });
  }

  setAudioTrack(trackId: number): void {
    this.send({ type: "SET_AUDIO_TRACK", trackId });
  }

  disconnect(): void {
    this.context?.endCurrentSession(true);
  }

  closePanel(): void {
    this.store.set({ panelOpen: false });
  }

  private togglePanel(): void {
    const open = !this.store.state.panelOpen;
    this.store.set({ panelOpen: open });
    if (open) this.render();
  }

  private openPanel(): void {
    this.store.set({ panelOpen: true });
    this.render();
  }

  /** renderCastPanel: recomputed on every remote event while the panel is open. */
  private render(): void {
    if (this.disposed || !this.store.state.panelOpen) return;
    const host = this.host;
    const rs = this.remoteState;
    const rp = this.remotePlayer;
    const cur = rp?.currentTime || 0;
    const dur = rp?.duration || 0;
    const clock = (s: number): string => formatTime(Math.max(0, s || 0));
    const episodes = host.episodes.map((ep, i) => ({
      value: String(i),
      label: `S${ep.seasonNum}E${ep.episodeNum} — ${ep.title || "Episode"}`,
    }));
    const tracks = rs?.subtitleTracks || [];
    const audio = rs?.audioTracks || [];
    this.store.set({
      view: {
        deviceTitle: `Casting to ${this.deviceName || "TV"}`,
        title: rs?.showTitle || host.show?.title || "Streamio",
        sub: [rs?.episodeLabel || this.castEpisodeLabel, rs?.episodeTitle].filter(Boolean).join(" · "),
        poster: host.show?.poster || "",
        fill: dur ? `${(cur / dur) * 100}%` : "0%",
        elapsed: clock(cur),
        duration: clock(dur),
        paused: !!rp?.isPaused,
        muted: !!rp?.isMuted,
        volume: Math.round((rp?.volumeLevel ?? 1) * 100),
        autoplayNext: host.autoplayNextEnabled,
        skipLabel: rs?.skipSegment ? rs.skipSegment.label || "Skip" : null,
        episodes,
        episodeIndex: host.episodeIndex,
        subtitles: tracks.length
          ? [{ value: "-1", label: "Subtitles off" }, ...tracks.map((t) => ({ value: String(t.id), label: t.name || t.lang || "" }))]
          : [],
        activeTrackId: rs?.activeTrackId ?? null,
        audio: audio.map((t) => ({ value: String(t.id), label: t.name || t.lang || "" })),
        activeAudioTrackId: rs?.activeAudioTrackId != null && rs.activeAudioTrackId > 0 ? rs.activeAudioTrackId : null,
      },
    });
  }
}
