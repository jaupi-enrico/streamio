/**
 * The watch page's state and everything that changes it — the ~70 module
 * globals and the functions around them in public/scripts/watch.js, as one
 * object created per page mount.
 *
 * It lives outside React on purpose. Resolving a stream, the hls.js instance,
 * retry timers and (later) the room socket and the Cast session are sequenced
 * imperative state that a re-render must never restart. React reads a
 * snapshot through `useSyncExternalStore` and renders it; the per-frame
 * updates (progress bar, clock, buffered range) never go through it.
 *
 * Lifecycle: created and `start()`ed in an effect, `dispose()`d in its
 * cleanup. Under StrictMode's double mount the first instance is disposed
 * before it can finish anything — every await below checks `disposed`.
 *
 * Episodes are addressed by id, never by position in the rendered grid: the
 * grid shows a slice (one season, a filter) while `episodes` stays the whole
 * show, and autoplay-next, room sync and Cast all index into the whole list.
 */
import { ensureSessionQuietly, fetchPublic, getAccessToken, api } from "../../lib/auth";
import { getPreferences, loadPreferences, type Preferences } from "../../lib/preferences";
import { getSelectedProvider, setSelectedProvider, withProvider } from "../../lib/provider-selection";
import {
  episodeLabel,
  initialCompact,
  toEpisodeCard,
  viewRevealing,
  type ApiEpisode,
  type ApiSeason,
  type EpisodeCard,
  type EpisodeView,
  type ProgressEntry,
} from "./logic/episodes";
import {
  MAX_STREAM_RETRIES,
  defaultQualityLevel,
  isEffectivelyFinished,
  preferredSubtitleIndex,
  retryDelayMs,
} from "./logic/playback";
import type { StreamPayload } from "./logic/stream";
import { PlayerControls } from "./controls";
import { PlayerEngine } from "./player-engine";
import { UpNext } from "./upnext";
import { RoomSync } from "./room";
import { CastController } from "./cast";
import { Downloader } from "./download";
import type { ShareContent } from "../../components/social/ShareModal";
import type { ShowDetails } from "../../lib/types";

/** The show as `GET /api/shows/:id` serializes it — the fields this page reads. */
export interface WatchShow {
  id?: string;
  title?: string | null;
  overview?: string | null;
  poster?: string | null;
  banner?: string | null;
  rating?: number | string | null;
  quality?: string | null;
  runtime?: number | null;
  released?: string | null;
  imdbId?: string | null;
  providerName?: string | null;
  genres?: { id?: string | number; name?: string | null }[] | null;
  seasons?: ApiSeason[];
  details?: ShowDetails | null;
}

/** One entry of `GET /api/episodes/:id/servers` — POSTed back verbatim to resolve it. */
export interface ServerEntry {
  name?: string;
  server?: string;
  src?: string;
  [key: string]: unknown;
}

export type ContentType = "episode" | "movie";

/** A line of muted or error text in place of a grid's buttons. */
export interface Notice {
  text: string;
  error: boolean;
}

export interface WatchSnapshot {
  showId: string;
  /** The page heading: "Loading...", the title, "No content selected". */
  heading: string;
  show: WatchShow | null;
  /** `#errorMsg`'s text, or null when empty. */
  error: string | null;

  /** The placeholder's message; null while it still shows the initial spinner. */
  placeholder: string | null;
  /** Placeholder vs <video>; null until either was first shown (the stylesheet decides). */
  playerShown: boolean | null;

  episodesSection: boolean;
  /** Replaces the grid's buttons: "No episodes available." / "Error loading episodes". */
  episodesNotice: Notice | null;
  /** True once the grid was rendered from a list (the vanilla renderEpisodeGrid ran). */
  gridRendered: boolean;
  episodes: EpisodeCard[];
  episodeIndex: number;
  progress: ReadonlyMap<string, ProgressEntry>;
  view: EpisodeView;
  nowPlaying: EpisodeCard | null;

  servers: ServerEntry[];
  /** Replaces the server buttons; the initial hint until an episode is picked. */
  serversNotice: Notice | null;
  /** The highlighted server button, -1 for none. */
  activeServer: number;
}

const INITIAL: WatchSnapshot = {
  showId: "",
  heading: "Loading...",
  show: null,
  error: null,
  placeholder: null,
  playerShown: null,
  episodesSection: false,
  episodesNotice: null,
  gridRendered: false,
  episodes: [],
  episodeIndex: -1,
  progress: new Map(),
  view: { seasonId: "all", query: "", compact: false },
  nowPlaying: null,
  servers: [],
  serversNotice: { text: "Select an episode to see available servers", error: false },
  activeServer: -1,
};

export class WatchSession {
  private snap: WatchSnapshot;
  private listeners = new Set<() => void>();
  private disposed = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  readonly engine: PlayerEngine;
  prefs: Preferences = getPreferences();
  autoplayNextEnabled = this.prefs.autoplay;

  playbackId = "";
  playbackType: ContentType = "episode";
  episodeLabel = "";
  serverIndex = 0;
  serverName = "";
  private streamRetryCount = 0;
  /**
   * Set once what's loaded has been recorded as finished (the vanilla
   * `player._markedDone`), so the autosave can't write completed:false over it.
   */
  private markedDone = false;
  private cleanups: (() => void)[] = [];

  // Deep-link support for shared clips: /watch?id=…&ep=<episodeId>&t=<seconds>
  deepLinkEpisodeId: string | null = null;
  deepLinkTimeSeconds: number | null = null;
  deepLinkTimeConsumed = false;

  /** Scroll/focus hook the grid fills in; see EpisodeGrid. */
  episodeButton: (id: string) => HTMLButtonElement | null = () => null;
  /** Makes pending snapshot changes reach the DOM synchronously (flushSync). */
  flush: (fn: () => void) => void = (fn) => fn();
  /** The app's share modal; filled by the page. */
  openShare: (content: ShareContent) => void = () => {};

  readonly controls: PlayerControls;
  readonly upNext: UpNext;
  readonly room: RoomSync;
  readonly cast: CastController;
  readonly download: Downloader;
  /** Joining a paused room keeps the first stream paused through its autoplay. */
  pendingRoomPause = false;

  constructor(video: HTMLVideoElement, showId: string) {
    this.engine = new PlayerEngine(video);
    this.snap = { ...INITIAL, showId };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const session = this;
    this.controls = new PlayerControls({
      player: video,
      get prefs() {
        return session.prefs;
      },
      get hls() {
        return session.engine.hls;
      },
      get playerVisible() {
        return session.snap.playerShown !== false;
      },
      goEpisode: (delta) => void this.goEpisode(delta),
      skipSegment: () => this.skipSegment(),
      mediaTitle: () => {
        const showTitle = this.snap.show?.title || document.title;
        return this.playbackType === "episode" && this.episodeLabel ? `${this.episodeLabel} — ${showTitle}` : showTitle;
      },
      mediaArtwork: () => [this.snap.show?.poster, this.snap.show?.banner].filter((s): s is string => Boolean(s)),
    });

    this.upNext = new UpNext({
      player: video,
      get prefs() {
        return session.prefs;
      },
      get casting() {
        return session.casting;
      },
      get playbackId() {
        return session.playbackId;
      },
      get playbackType() {
        return session.playbackType;
      },
      get showId() {
        return session.showId;
      },
      get showTitle() {
        return session.snap.show?.title || "";
      },
      get showImdbId() {
        return session.snap.show?.imdbId || "";
      },
      get showReleased() {
        return session.snap.show?.released || "";
      },
      get autoplayNextEnabled() {
        return session.autoplayNextEnabled;
      },
      set autoplayNextEnabled(v) {
        session.autoplayNextEnabled = v;
      },
      currentEpisode: () => this.snap.episodes[this.snap.episodeIndex],
      nextEpisode: () => this.snap.episodes[this.snap.episodeIndex + 1],
      playNextEpisode: () => void this.playNextEpisode(),
      markCurrentPlaybackDone: () => this.markCurrentPlaybackDone(),
    });

    this.room = new RoomSync({
      player: video,
      get casting() {
        return session.casting;
      },
      get showId() {
        return session.showId;
      },
      get playbackId() {
        return session.playbackId;
      },
      get playbackType() {
        return session.playbackType;
      },
      get episodeLabel() {
        return session.episodeLabel;
      },
      get episodes() {
        return session.snap.episodes;
      },
      get serverCount() {
        return session.snap.servers.length;
      },
      selectEpisodeByData: (ep, index) => this.selectEpisodeByData(ep, index),
      loadServersForId: (id, type) => this.loadServersForId(id, type),
      playServerAt: (index, highlight) => this.playServerAt(index, highlight),
      setJoinTarget: (episodeId, seconds) => {
        if (episodeId) this.deepLinkEpisodeId = episodeId;
        this.deepLinkTimeSeconds = seconds;
      },
      get pendingRoomPause() {
        return session.pendingRoomPause;
      },
      set pendingRoomPause(v) {
        session.pendingRoomPause = v;
      },
    });

    this.cast = new CastController({
      player: video,
      get container() {
        return session.controls.ui.container;
      },
      get showId() {
        return session.showId;
      },
      get show() {
        return session.snap.show;
      },
      get playbackId() {
        return session.playbackId;
      },
      get playbackType() {
        return session.playbackType;
      },
      get episodeLabel() {
        return session.episodeLabel;
      },
      get episodes() {
        return session.snap.episodes;
      },
      get episodeIndex() {
        return session.snap.episodeIndex;
      },
      get serverName() {
        return session.serverName;
      },
      get serverIndex() {
        return session.serverIndex;
      },
      get introIds() {
        return session.upNext.introDbIds;
      },
      get heading() {
        return session.snap.heading;
      },
      get inRoom() {
        return session.room.code !== null;
      },
      get autoplayNextEnabled() {
        return session.autoplayNextEnabled;
      },
      set autoplayNextEnabled(v) {
        session.autoplayNextEnabled = v;
      },
      showPlayerMessage: (msg) => this.showPlayerMessage(msg),
      saveProgress: (completed, override) => void this.saveProgress(completed, override),
      onReceiverEpisode: (id, label) => this.onReceiverEpisode(id, label),
      roomToast: (msg) => this.room.showToast(msg),
    });

    this.download = new Downloader({
      manifestUrl: () => this.engine.hls?.url || this.engine.videoUrl || null,
      title: () => this.snap.heading,
    });
  }

  /** The page is a remote for a Cast device; the local element is paused and dimmed. */
  get casting(): boolean {
    return this.cast.isCasting;
  }

  // ── Store plumbing ──

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WatchSnapshot => this.snap;

  private set(patch: Partial<WatchSnapshot>): void {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  get state(): WatchSnapshot {
    return this.snap;
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }

  get player(): HTMLVideoElement {
    return this.engine.video;
  }

  get showId(): string {
    return this.snap.showId;
  }

  get episodes(): EpisodeCard[] {
    return this.snap.episodes;
  }

  get episodeIndex(): number {
    return this.snap.episodeIndex;
  }

  dispose(): void {
    if (this.disposed) return;
    // Leaving the page in-app never fires beforeunload; save the same way.
    this.saveOnLeave();
    this.cast.dispose(); // saves the TV's position, as beforeunload did
    this.disposed = true;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.upNext.dispose();
    this.room.dispose();
    this.download.dispose();
    this.controls.dispose();
    this.engine.destroy();
    this.listeners.clear();
  }

  // ── Placeholder / player visibility ──

  showPlayerMessage(msg: string): void {
    this.set({ placeholder: msg, playerShown: false });
  }

  private showPlayer(): void {
    this.set({ playerShown: true });
    this.controls.init();
    this.controls.updateMediaSession();
  }

  private cleanupPlayer(): void {
    this.engine.cleanup();
    // The placeholder comes back with whatever it last said.
    this.set({ playerShown: false });
  }

  // ── Loading ──

  /**
   * Playback of an 18+ title depends on the viewer's preference, so the
   * server has to know who is asking before the first content request.
   */
  async start(): Promise<void> {
    this.wireProgressSaving();
    void this.cast.init();
    await ensureSessionQuietly();
    if (this.disposed) return;
    this.prefs = await loadPreferences();
    if (this.disposed) return;
    this.autoplayNextEnabled = this.prefs.autoplay;
    await this.loadWatchPage();
  }

  /**
   * Pins the provider once per load: the URL wins (details linked here with
   * it), then the stored one, then the server's own default — the one it
   * would fall back to anyway, which the Cast receiver and sharing need
   * spelled out rather than left empty.
   */
  private async ensureActiveProvider(): Promise<string> {
    const fromUrl = new URLSearchParams(window.location.search).get("provider");
    if (fromUrl) {
      setSelectedProvider(fromUrl);
      return fromUrl;
    }
    const stored = getSelectedProvider();
    if (stored) return stored;
    try {
      const res = await fetchPublic("/api/providers");
      const data = (await res.json()) as { default?: string; providers?: string[] };
      const fallback = data?.default || data?.providers?.[0] || "";
      if (fallback) {
        setSelectedProvider(fallback);
        return fallback;
      }
    } catch {
      // Non-fatal: the page still plays, the TV just loses autoplay-next.
    }
    return "";
  }

  private async loadWatchPage(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const showId = this.showId;
    this.deepLinkEpisodeId = params.get("ep") || null;
    const tParam = params.get("t");
    this.deepLinkTimeSeconds = tParam !== null && !isNaN(parseInt(tParam, 10)) ? parseInt(tParam, 10) : null;
    this.deepLinkTimeConsumed = false;

    // Before anything reads the stored provider — and before the room join,
    // which may override it with the room's.
    await this.ensureActiveProvider();
    if (this.disposed) return;

    // May replace the deep-link episode/time with the room's shared state,
    // and holds back broadcasting until the initial pick below has settled.
    await this.room.initRoomJoin();
    if (this.disposed) return;

    if (!showId) {
      this.set({ heading: "No content selected", error: "Please select a title from the catalog." });
      this.showPlayerMessage("No content selected");
      return;
    }

    try {
      const res = await fetchPublic(withProvider(`/api/shows/${encodeURIComponent(showId)}`));
      const data = (await res.json()) as { data?: WatchShow; preference?: string };
      if (this.disposed) return;
      if (res.status === 403) {
        // The server names which preference unlocks this one — sources gate
        // different kinds of 18+ content behind different keys.
        throw new Error(
          `This title is flagged 18+. Enable "${data.preference || "adult-all"}" on your account to watch it.`,
        );
      }
      if (!res.ok || !data.data) throw new Error("Show not found");

      const show = data.data;
      this.set({ show, heading: show.title || "Untitled" });

      if (show.seasons && show.seasons.length > 0) {
        await this.renderEpisodes();
      } else {
        this.set({ episodesSection: false });
        this.showPlayerMessage("Select a server below");
        await this.loadServersForId(showId, "movie");
        if (this.snap.servers.length) await this.playServerAt(0, true);
      }
    } catch (err) {
      if (this.disposed) return;
      this.set({ error: `Error: ${(err as Error).message}` });
      this.showPlayerMessage("Error loading content");
    } finally {
      this.room.releaseJoinGuard();
    }
  }

  /**
   * Every episode's progress row for this show in one call, so the grid can
   * mark watched/in-progress without a request per episode. Guests and
   * errors just leave every episode unmarked.
   */
  private async loadEpisodeProgressMap(): Promise<void> {
    const map = new Map<string, ProgressEntry>();
    this.set({ progress: map });
    if (!getAccessToken()) return;
    try {
      const provider = getSelectedProvider();
      if (!this.showId || !provider) return;
      const rows = await api<ProgressEntry[]>(
        `/api/account/history/progress/${encodeURIComponent(provider)}/${encodeURIComponent(this.showId)}`,
      );
      if (Array.isArray(rows)) {
        rows.forEach((row) => map.set(row.episode_id, row));
        this.set({ progress: new Map(map) });
      }
    } catch (e) {
      console.warn("[episodeProgress] failed to load", e);
    }
  }

  private async renderEpisodes(): Promise<void> {
    const show = this.snap.show;
    if (!show?.seasons) return;
    this.set({ episodesSection: true });
    const episodes: EpisodeCard[] = [];
    this.showPlayerMessage("Loading episodes…");

    try {
      for (const season of show.seasons) {
        try {
          const res = await fetchPublic(withProvider(`/api/seasons/${encodeURIComponent(season.id)}/episodes`));
          const data = (await res.json()) as { data?: ApiEpisode[] };
          if (res.ok && Array.isArray(data.data)) data.data.forEach((ep) => episodes.push(toEpisodeCard(ep, season)));
        } catch (e) {
          console.warn(e);
        }
        if (this.disposed) return;
      }

      // Fallback: the episodes the show itself carried.
      if (!episodes.length) {
        show.seasons.forEach((season) => season.episodes?.forEach((ep) => episodes.push(toEpisodeCard(ep, season))));
      }

      if (!episodes.length) {
        this.set({ episodesNotice: { text: "No episodes available.", error: false } });
        this.showPlayerMessage("No episodes available");
        return;
      }

      this.set({ episodes });
      await this.loadEpisodeProgressMap();
      if (this.disposed) return;

      this.showPlayerMessage("Select an episode");
      // Long runs open as a dense number grid; an explicit layout preference
      // overrides that.
      this.set({
        gridRendered: true,
        view: { seasonId: "all", query: "", compact: initialCompact(this.prefs.episode_layout, episodes.length) },
      });

      let targetIndex = 0;
      if (this.deepLinkEpisodeId) {
        const idx = episodes.findIndex((e) => e.id === this.deepLinkEpisodeId);
        if (idx !== -1) targetIndex = idx;
      } else {
        // Resume at the first episode not marked completed, rather than
        // always restarting from S1E1.
        const idx = episodes.findIndex((e) => !this.snap.progress.get(e.id)?.completed);
        if (idx !== -1) targetIndex = idx;
      }
      const targetEp = episodes[targetIndex];
      if (targetEp) {
        // Resuming mid-run can land outside the open season, so scope the
        // grid to it before asking for its button.
        this.revealEpisode(targetEp);
        this.flush(() => this.set({ episodeIndex: targetIndex }));
        this.episodeButton(targetEp.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        this.episodeLabel = episodeLabel(targetEp);
        this.set({ nowPlaying: targetEp });
        await this.loadServersForId(targetEp.id, "episode");
        if (this.snap.servers.length) await this.playServerAt(0, true);
      }
    } catch {
      if (this.disposed) return;
      this.set({ episodesNotice: { text: "Error loading episodes", error: true } });
      this.showPlayerMessage("Error loading episodes");
    }
  }

  // ── Progress and resume ──

  /**
   * History writes: every 30s while playing, on pause, when leaving, and
   * once as completed when playback reaches the tail. `ended` advances to
   * the next episode when autoplay is on. While casting the local element is
   * frozen and the Cast controller writes history instead.
   */
  private wireProgressSaving(): void {
    const player = this.player;
    const on = <K extends keyof HTMLVideoElementEventMap>(type: K, fn: () => void): void => {
      player.addEventListener(type, fn);
      this.cleanups.push(() => player.removeEventListener(type, fn));
    };

    const interval = setInterval(() => {
      if (this.casting) return;
      if (!this.markedDone && !player.paused) void this.saveProgress(false);
    }, 30_000);
    this.cleanups.push(() => clearInterval(interval));

    on("pause", () => {
      if (this.casting) return;
      if (!this.markedDone) void this.saveProgress(false);
    });
    on("ended", () => {
      // The receiver advances on its own while casting; the hidden local
      // player doing it too would fight it over what plays on the TV.
      if (this.casting) return;
      this.upNext.hideNextEpPrompt();
      this.markCurrentPlaybackDone(); // covers movies/last episode, where playNextEpisode no-ops
      void this.playNextEpisode();
    });
    // Reaching the tail is what records completion, not "ended": seeking into
    // the last seconds often fires no "ended" at all.
    on("timeupdate", () => {
      if (isEffectivelyFinished(player.duration, player.currentTime)) this.markCurrentPlaybackDone();
      this.upNext.onTimeUpdate();
    });

    const onUnload = (): void => {
      if (this.casting) {
        this.cast.saveCastProgress(false);
        return;
      }
      this.saveOnLeave();
    };
    window.addEventListener("beforeunload", onUnload);
    this.cleanups.push(() => window.removeEventListener("beforeunload", onUnload));
  }

  private saveOnLeave(): void {
    if (this.disposed || this.casting) return;
    if (!this.markedDone && !this.player.paused) void this.saveProgress(false);
  }

  /**
   * Records what's loaded as finished. Shared by "ended", the next-episode
   * paths and skip-to-end: each means the viewer is done with it.
   */
  markCurrentPlaybackDone(): void {
    if (this.casting) return; // the receiver reports its own progress
    if (this.markedDone) return;
    this.markedDone = true;
    void this.saveProgress(true);
  }

  private async resumeProgress(episodeId: string, contentType: ContentType): Promise<number | null> {
    try {
      const entry = await api<ProgressEntry | null>("/api/account/history/progress/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: getSelectedProvider(),
          showId: this.showId,
          episodeId: contentType === "episode" ? episodeId : null,
        }),
      });
      console.log("[resume] looking for", { showId: this.showId, episodeId, contentType });
      console.log("[resume] found", entry);
      if (entry && entry.progress_seconds > 10 && !entry.completed) return entry.progress_seconds;
    } catch (e) {
      console.error("[resume] error", e);
    }
    return null;
  }

  /**
   * One history row for what's playing. `override` reports a stream playing
   * elsewhere (Cast), whose position the hidden local element doesn't know.
   */
  async saveProgress(
    completed = false,
    override: {
      playbackId?: string;
      positionSeconds?: number;
      durationSeconds?: number;
      contentType?: ContentType;
      episodeLabel?: string;
    } | null = null,
  ): Promise<void> {
    if (!this.snap.show || this.disposed) return;
    const playbackId = override?.playbackId || this.playbackId;
    if (!playbackId) return;

    let progressSeconds: number;
    let durationSeconds: number | null;
    if (override) {
      progressSeconds = Math.floor(override.positionSeconds || 0);
      durationSeconds = Number.isFinite(override.durationSeconds) ? Math.floor(override.durationSeconds!) : null;
    } else {
      const player = this.player;
      if (this.snap.playerShown === false) return;
      progressSeconds = Math.floor(player.currentTime);
      durationSeconds = player.duration && !isNaN(player.duration) ? Math.floor(player.duration) : null;
    }
    if (progressSeconds < 3) return; // ignore accidental starts

    const showId = this.showId;
    const isEpisode = (override?.contentType || this.playbackType) === "episode";
    const label = override?.episodeLabel || this.episodeLabel;
    const res = await api("/api/account/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: getSelectedProvider(),
        show_id: showId,
        episode_id: isEpisode ? playbackId : null,
        progress_seconds: progressSeconds,
        episode_label: isEpisode ? label : null,
        duration_seconds: durationSeconds,
        completed,
      }),
    }).catch(() => {});
    console.log("Progress saved", {
      showId,
      episodeId: playbackId,
      progressSeconds,
      completed,
      casting: !!override,
      response: res,
    });

    // Finishing an episode marks it in the grid without a reload.
    if (isEpisode) {
      const progress = new Map(this.snap.progress);
      progress.set(playbackId, {
        episode_id: playbackId,
        completed,
        progress_seconds: progressSeconds,
        duration_seconds: durationSeconds,
      });
      this.set({ progress });
    }
  }

  /** A shared clip's start (once per page load), else the saved position. */
  private async applyStartPosition(): Promise<void> {
    const player = this.player;
    if (this.deepLinkTimeSeconds != null && !this.deepLinkTimeConsumed) {
      this.deepLinkTimeConsumed = true;
      player.currentTime = this.deepLinkTimeSeconds;
      return;
    }
    if (!this.prefs.resume_playback) return;
    const resume = await this.resumeProgress(this.playbackId, this.playbackType);
    if (resume && !this.disposed) player.currentTime = resume;
  }

  // ── Episode navigation ──

  /** Autoplay's advance: honours the autoplay-next preference. */
  async playNextEpisode(): Promise<void> {
    if (!this.autoplayNextEnabled) return;
    if (this.playbackType !== "episode") return; // movies have no "next"
    const episodes = this.snap.episodes;
    if (!episodes.length || this.episodeIndex === -1) return;
    const nextIndex = this.episodeIndex + 1;
    const nextEp = episodes[nextIndex];
    if (!nextEp) {
      this.showPlayerMessage("Hai completato tutti gli episodi disponibili.");
      return;
    }
    this.markCurrentPlaybackDone();
    this.showPlayerMessage(`Caricamento S${nextEp.seasonNum}E${nextEp.episodeNum}…`);
    await this.selectEpisodeByData(nextEp, nextIndex);
  }

  /**
   * Explicit navigation (keys, media keys). Unlike playNextEpisode this
   * ignores the autoplay preference — that is about what happens on its own.
   */
  async goEpisode(delta: number): Promise<void> {
    if (this.playbackType !== "episode") return;
    const episodes = this.snap.episodes;
    if (!episodes.length || this.episodeIndex === -1) return;
    const index = this.episodeIndex + delta;
    const ep = episodes[index];
    const icon = delta > 0 ? "skipForward" : "skipBack";
    if (!ep) {
      this.controls.showOsd(icon, delta > 0 ? "Last episode" : "First episode");
      return;
    }
    if (delta > 0) this.markCurrentPlaybackDone();
    this.controls.showOsd(icon, `S${ep.seasonNum}E${ep.episodeNum}`);
    await this.selectEpisodeByData(ep, index);
  }

  /** The S key: the Skip button's action, when it is showing. */
  skipSegment(): void {
    this.upNext.skipIfShown();
  }

  /** The receiver advanced by itself: the grid follows what's on the TV. */
  private onReceiverEpisode(episodeId: string, label: string): void {
    const idx = this.snap.episodes.findIndex((e) => e.id === episodeId);
    if (idx === -1) return;
    this.playbackId = episodeId;
    this.episodeLabel = label;
    this.set({ episodeIndex: idx });
  }

  /** The Share button: the title, or the episode, seeded with a 30s clip around the playhead. */
  shareCurrent(): void {
    const player = this.player;
    const showId = this.showId;
    const provider = getSelectedProvider();
    if (!showId || !provider) return;
    const isEpisode = this.playbackType === "episode";
    const duration = player.duration;
    const hasDuration = Boolean(duration && !isNaN(duration) && duration > 0);
    const seedStart = hasDuration ? Math.max(0, Math.floor(player.currentTime)) : undefined;
    const seedEnd = hasDuration ? Math.min(Math.floor(duration), (seedStart ?? 0) + 30) : undefined;
    const title = this.snap.show?.title;
    this.openShare({
      provider,
      show_id: showId,
      episode_id: isEpisode ? this.playbackId : undefined,
      episode_label: isEpisode ? this.episodeLabel : undefined,
      duration: hasDuration ? duration : undefined,
      clip_start_seconds: seedStart,
      clip_end_seconds: seedEnd,
      summary: title
        ? `Sharing "${title}"${isEpisode && this.episodeLabel ? ` — ${this.episodeLabel}` : ""}`
        : undefined,
    });
  }


  /** The season tabs, the filter box and the density toggle. */
  setView(patch: Partial<EpisodeView>): void {
    this.set({ view: { ...this.snap.view, ...patch } });
  }

  /**
   * Makes sure an episode is on screen before it is highlighted: autoplay,
   * a room or a deep link can land on one the open season or the filter
   * hides. Synchronous, so its button exists for the scroll that follows.
   */
  revealEpisode(ep: EpisodeCard | undefined): void {
    if (!ep) return;
    const next = viewRevealing(this.snap.episodes, this.snap.view, ep);
    if (next !== this.snap.view) this.flush(() => this.set({ view: next }));
  }

  /** A click on an episode in the grid. */
  async selectEpisode(ep: EpisodeCard, btn: HTMLButtonElement | null): Promise<void> {
    const label = episodeLabel(ep);
    this.playbackId = ep.id;
    this.playbackType = "episode";
    this.episodeLabel = label;

    const idx = this.snap.episodes.findIndex((e) => e.id === ep.id);
    this.set({
      episodeIndex: idx !== -1 ? idx : this.snap.episodeIndex,
      nowPlaying: this.snap.episodes[idx !== -1 ? idx : this.snap.episodeIndex] ?? null,
    });

    this.showPlayerMessage(`Loading ${label}…`);
    btn?.blur();
    await this.loadServersForId(ep.id, "episode");
    if (this.snap.servers.length) await this.playServerAt(0, true);
  }

  /**
   * Makes `ep` current from anywhere but a click — autoplay, keys, a room.
   * Reveals and scrolls to it first.
   */
  async selectEpisodeByData(ep: EpisodeCard, index: number): Promise<void> {
    this.playbackId = ep.id;
    this.playbackType = "episode";
    this.episodeLabel = episodeLabel(ep);
    this.set({ episodeIndex: index, nowPlaying: ep });

    this.revealEpisode(ep);
    const btn = this.episodeButton(ep.id);
    if (btn) {
      btn.blur();
      btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }

    await this.loadServersForId(ep.id, "episode");
    if (this.snap.servers.length) await this.playServerAt(0, true);
  }

  // ── Servers and resolving ──

  async loadServersForId(contentId: string, contentType: ContentType): Promise<void> {
    this.playbackId = contentId;
    this.playbackType = contentType;
    try {
      const res = await fetchPublic(
        withProvider(`/api/episodes/${encodeURIComponent(contentId)}/servers?contentType=${contentType}`),
      );
      const data = (await res.json()) as { data?: ServerEntry[] };
      if (this.disposed) return;
      if (!res.ok || !data.data) throw new Error("No servers");
      const servers = Array.isArray(data.data) ? data.data : [];
      if (!servers.length) {
        this.set({ servers, activeServer: -1, serversNotice: { text: "No servers available.", error: false } });
        this.showPlayerMessage("No servers available");
        return;
      }
      this.showPlayerMessage("Select a server to play");
      this.set({ servers, activeServer: -1, serversNotice: null });
    } catch (err) {
      if (this.disposed) return;
      this.set({ servers: [], activeServer: -1, serversNotice: { text: `Error: ${(err as Error).message}`, error: true } });
      this.showPlayerMessage("Error loading servers");
    }
  }

  /**
   * Resolves server `index` and plays it. `highlight` is whether a button
   * stands for this call (a click, the automatic first pick) — a retry has
   * none, and on the vanilla page it clears the highlight. `fresh` is a retry
   * re-resolving past the cached URL; anything else restarts the retry budget.
   *
   * A plain POST every time — never a query, never cached: the answer is a
   * signed URL that expires within minutes.
   */
  async playServerAt(index: number, highlight: boolean, fresh = false): Promise<void> {
    const server = this.snap.servers[index];
    if (!server) return;
    if (!fresh) this.streamRetryCount = 0;
    this.serverIndex = index;
    this.serverName = server.name || server.server || "";
    this.set({ activeServer: highlight ? index : -1 });
    this.showPlayerMessage(`Resolving stream from ${server.name || server.server || "server"}…`);
    try {
      const freshParam = fresh ? "&fresh=1" : "";
      const res = await fetchPublic(
        withProvider(
          `/api/episodes/${encodeURIComponent(this.playbackId)}/video?contentType=${this.playbackType}${freshParam}`,
        ),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server }) },
      );
      const payload = (await res.json()) as { data?: StreamPayload; error?: string };
      if (this.disposed) return;
      if (!res.ok || !payload.data) throw new Error(payload.error || `HTTP ${res.status}`);
      this.playResolvedStream(payload.data);
      this.room.broadcastContentChange();
    } catch (err) {
      if (this.disposed) return;
      this.showPlayerMessage(`Error: ${(err as Error).message}`);
    }
  }

  /** A click on a server button. */
  playServer(index: number, btn: HTMLButtonElement | null): void {
    btn?.blur();
    void this.playServerAt(index, true);
  }

  /**
   * Re-resolves the current server past the cached URL after a fatal error —
   * a fresh resolve can land on a working stream when the cached one didn't.
   */
  private retryCurrentStream(): void {
    if (this.streamRetryCount >= MAX_STREAM_RETRIES) {
      this.showPlayerMessage("Stream unavailable after several attempts");
      return;
    }
    this.streamRetryCount++;
    const delay = retryDelayMs(this.streamRetryCount);
    this.showPlayerMessage(`Stream failed, retrying (${this.streamRetryCount}/${MAX_STREAM_RETRIES})…`);
    this.later(() => void this.playServerAt(this.serverIndex, false, true), delay);
  }

  // ── Playback ──

  private playResolvedStream(stream: StreamPayload): void {
    this.cleanupPlayer();
    this.markedDone = false;
    this.upNext.onNewStream();
    this.cast.setMedia(stream);
    // Already casting: a change made on the page plays on the TV.
    if (this.cast.playOnReceiver()) return;

    const engine = this.engine;
    const url = engine.playableUrl(stream);
    if (!url) {
      this.showPlayerMessage("Stream not available");
      return;
    }
    engine.videoUrl = url;
    this.showPlayer();
    const player = this.player;

    // A room joined paused stays paused through the autoplay below.
    if (this.pendingRoomPause) {
      this.pendingRoomPause = false;
      player.addEventListener("playing", () => player.pause(), { once: true });
    }

    engine.clearSubtitleTracks();
    const subs = stream?.subtitles || stream?.captions || [];
    if (Array.isArray(subs) && subs.length) {
      const shown = preferredSubtitleIndex(
        subs.map((s) => s.lang),
        this.prefs,
      );
      subs.forEach((s, i) => engine.addSubtitleTrack(s, i === shown));
    }
    // Each new source resets the element to defaultPlaybackRate, so the
    // preferred speed applies per stream and a mid-episode change doesn't stick.
    player.defaultPlaybackRate = this.prefs.playback_speed;
    player.playbackRate = this.prefs.playback_speed;

    const controls = this.controls;
    let hlsSubtitlePrefApplied = false;
    let kind: string = "";
    kind = engine.load(url, stream, {
      onMetadata: async () => {
        controls.updateSubtitleMenu();
        await this.applyStartPosition();
        // Progressive files get a second play() after the start position;
        // the browser's own HLS didn't on the vanilla page, and doesn't here.
        if (kind === "progressive" && !this.disposed) player.play().catch(() => {});
      },
      onManifestParsed: async () => {
        this.streamRetryCount = 0;
        const hls = engine.hls;
        if (hls) {
          const level = defaultQualityLevel(hls.levels, this.prefs.default_quality);
          if (level !== null) hls.currentLevel = level;
        }
        controls.updateQualityMenu();
        controls.updateSubtitleMenu();
        player.play().catch(() => {});
        await this.applyStartPosition();
        if (!this.disposed) player.play().catch(() => {});
      },
      onFatal: () => this.retryCurrentStream(),
      onLevelsUpdated: () => controls.updateQualityMenu(),
      onLevelSwitched: () => controls.updateQualityStyle(),
      onSubtitleTracksUpdated: () => {
        const hls = engine.hls;
        // Once per stream: after that the choice is the viewer's, from the menu.
        if (hls && !hlsSubtitlePrefApplied && hls.subtitleTracks.length) {
          hlsSubtitlePrefApplied = true;
          const idx = preferredSubtitleIndex(
            hls.subtitleTracks.map((t) => t.lang),
            this.prefs,
            hls.subtitleTrack,
          );
          hls.subtitleTrack = idx;
          if (idx >= 0) hls.subtitleDisplay = true;
        }
        controls.updateSubtitleMenu();
      },
    });
    if (kind === "unsupported") this.showPlayerMessage("Browser does not support HLS");
  }
}
