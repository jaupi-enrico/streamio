/**
 * Watch parties — the room half of public/scripts/watch.js (initRoomJoin,
 * connectRoom, applyRoomState, the playback hooks and the panel's actions).
 *
 * Any member's play/pause/seek/episode/server change goes to the server and
 * is rebroadcast to everyone else, who apply it. `applyingRemoteState` and
 * the echo guard stop a client from re-broadcasting what it just received
 * (which would ping-pong forever), and from reporting the native
 * play/pause/seeked events that applying it fires. Same wire format and the
 * same timings as the vanilla page, so old and new clients share a room.
 */
import { api, getAccessToken, getSelfId } from "../../lib/auth";
import { getSelectedProvider, setSelectedProvider } from "../../lib/provider-selection";
import type { EpisodeCard } from "./logic/episodes";
import { RoomConnection, type RoomMember, type RoomMessage, type RoomState } from "./room-connection";
import { Store } from "./store";

/** What room sync needs from the page's session. */
export interface RoomHost {
  readonly player: HTMLVideoElement;
  readonly casting: boolean;
  readonly showId: string;
  readonly playbackId: string;
  readonly playbackType: "episode" | "movie";
  readonly episodeLabel: string;
  readonly episodes: readonly EpisodeCard[];
  readonly serverCount: number;
  selectEpisodeByData(ep: EpisodeCard, index: number): Promise<void>;
  loadServersForId(contentId: string, contentType: "episode" | "movie"): Promise<void>;
  playServerAt(index: number, highlight: boolean): Promise<void>;
  /** Primes the initial episode/position from the room's state. */
  setJoinTarget(episodeId: string | null, seconds: number): void;
  /** Joining a paused room keeps the first stream paused. */
  pendingRoomPause: boolean;
}

export interface RoomSnapshot {
  code: string | null;
  members: RoomMember[];
  ownerId: string | null;
  selfId: string | null;
  panelOpen: boolean;
  toast: { text: string; shown: boolean };
}

interface CreatedRoom {
  code: string;
  ownerId: string;
  members: RoomMember[];
  state: RoomState;
  isMember?: boolean;
}

export class RoomSync {
  readonly store = new Store<RoomSnapshot>({
    code: null,
    members: [],
    ownerId: null,
    selfId: null,
    panelOpen: false,
    toast: { text: "", shown: false },
  });

  private conn: RoomConnection | null = null;
  /** Suppresses re-broadcast while an incoming (or the initial) state is applied. */
  applyingRemoteState = false;
  private echoGuard: { until: number; time: number | null; playing: boolean | null } = {
    until: 0,
    time: null,
    playing: null,
  };
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private cleanups: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly host: RoomHost) {
    this.setupPlaybackHooks();
  }

  get code(): string | null {
    return this.store.state.code;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // The socket closes; membership stays, as when the vanilla tab closed.
    this.conn?.close();
    this.conn = null;
    clearInterval(this.heartbeat);
    clearTimeout(this.toastTimer);
    for (const t of this.timers) clearTimeout(t);
    for (const c of this.cleanups) c();
    this.store.close();
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ── Panel ──

  togglePanel(): void {
    this.store.set({ panelOpen: !this.store.state.panelOpen });
  }

  closePanel(): void {
    this.store.set({ panelOpen: false });
  }

  showToast(text: string): void {
    this.store.set({ toast: { text, shown: true } });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.store.set({ toast: { ...this.store.state.toast, shown: false } }), 3500);
  }

  // ── Echo suppression ──

  private armEchoGuard(time: number | null, playing: boolean | null): void {
    this.echoGuard = { until: Date.now() + 2500, time, playing };
  }

  private shouldSuppressEcho(kind: "seek" | "play", value: number | boolean): boolean {
    if (Date.now() > this.echoGuard.until) return false;
    if (kind === "seek") return this.echoGuard.time != null && Math.abs((value as number) - this.echoGuard.time) < 1.5;
    return this.echoGuard.playing === value;
  }

  /**
   * The local <video> is paused and frozen while casting, so everything it
   * fires then describes a player nobody is watching — room sync stands down
   * for the cast session rather than broadcast it.
   */
  private setupPlaybackHooks(): void {
    const player = this.host.player;
    const on = (type: "play" | "pause" | "seeked", fn: () => void): void => {
      player.addEventListener(type, fn);
      this.cleanups.push(() => player.removeEventListener(type, fn));
    };
    on("play", () => {
      if (this.host.casting) return;
      if (!this.conn || this.applyingRemoteState || this.shouldSuppressEcho("play", true)) return;
      this.conn.sendState({ playing: true, positionSeconds: player.currentTime });
    });
    on("pause", () => {
      if (this.host.casting) return;
      if (!this.conn || this.applyingRemoteState || this.shouldSuppressEcho("play", false)) return;
      this.conn.sendState({ playing: false, positionSeconds: player.currentTime });
    });
    on("seeked", () => {
      if (this.host.casting) return;
      if (!this.conn || this.applyingRemoteState || this.shouldSuppressEcho("seek", player.currentTime)) return;
      this.conn.sendState({ positionSeconds: player.currentTime, playing: !player.paused });
    });
  }

  /**
   * This client just switched episode or server. Called after every
   * successful resolve; silent while a received change is being applied.
   */
  broadcastContentChange(): void {
    if (!this.conn || this.applyingRemoteState) return;
    const isEpisode = this.host.playbackType === "episode";
    this.conn.sendState({
      provider: getSelectedProvider(),
      showId: this.host.showId,
      episodeId: isEpisode ? this.host.playbackId : null,
      episodeLabel: isEpisode ? this.host.episodeLabel : null,
      contentType: this.host.playbackType,
      playing: true,
      positionSeconds: 0,
    });
  }

  /**
   * Everyone in a room browses under the room's provider: ids differ per
   * provider, so anything else 404s or resolves the wrong title.
   */
  private syncProviderFromRoom(provider: string | undefined): void {
    if (!provider) return;
    if (getSelectedProvider() !== provider) setSelectedProvider(provider);
  }

  /**
   * An incoming (or the initial) shared state: switch to its episode/server
   * when needed, then match position and play/pause once the stream is ready.
   */
  private async applyRoomState(state: RoomState | undefined): Promise<void> {
    if (!state) return;
    const host = this.host;
    const isEpisode = state.contentType === "episode";
    const targetId = isEpisode ? state.episodeId : state.showId;
    const sameContent = targetId && host.playbackId === targetId && host.playbackType === state.contentType;

    const syncTimeAndPlayback = (): void => {
      const player = host.player;
      this.armEchoGuard(state.positionSeconds ?? null, state.playing ?? null);
      if (Number.isFinite(state.positionSeconds) && Math.abs(player.currentTime - state.positionSeconds!) > 2) {
        player.currentTime = state.positionSeconds!;
      }
      if (state.playing && player.paused) player.play().catch(() => {});
      else if (!state.playing && !player.paused) player.pause();
    };

    if (sameContent) {
      this.applyingRemoteState = true;
      syncTimeAndPlayback();
      this.later(() => (this.applyingRemoteState = false), 400);
      return;
    }

    if (!targetId) return;
    this.syncProviderFromRoom(state.provider);
    this.applyingRemoteState = true;
    try {
      if (isEpisode) {
        const idx = host.episodes.findIndex((e) => e.id === targetId);
        if (idx === -1) return; // another show, or the list isn't loaded yet
        await host.selectEpisodeByData(host.episodes[idx]!, idx);
      } else {
        await host.loadServersForId(state.showId!, "movie");
        if (host.serverCount) await host.playServerAt(0, true);
      }
      if (this.disposed) return;
      host.player.addEventListener("loadedmetadata", syncTimeAndPlayback, { once: true });
    } finally {
      this.later(() => (this.applyingRemoteState = false), 600);
    }
  }

  private setRoomUrlParam(code: string | null): void {
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    // The router's own history entry state is kept; the vanilla page had none.
    history.replaceState(history.state, "", url);
  }

  private connectRoom(code: string): void {
    this.conn?.close();
    const conn = new RoomConnection(code);
    this.conn = conn;
    conn.on("state", (msg) => {
      this.store.set({ members: msg.members || [], ownerId: msg.ownerId ?? null });
      void this.applyRoomState(msg.state);
    });
    conn.on("state_update", (msg) => void this.applyRoomState(msg.state));
    conn.on("presence", (msg) => this.store.set({ members: msg.members || [], ownerId: msg.ownerId ?? null }));
    conn.on("closed", () => {
      this.showToast("The watch party was closed.");
      this.conn = null;
      this.resetRoom();
    });
    conn.on("error", (msg: RoomMessage) => this.showToast(msg?.message || "Room error."));
    conn.connect();

    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      const player = this.host.player;
      if (this.conn && !player.paused && !this.applyingRemoteState) {
        this.conn.sendState({ playing: true, positionSeconds: player.currentTime });
      }
    }, 6000);
  }

  private resetRoom(): void {
    clearInterval(this.heartbeat);
    this.store.set({ code: null, members: [], ownerId: null });
    this.setRoomUrlParam(null);
  }

  async startWatchParty(): Promise<void> {
    const showId = new URLSearchParams(window.location.search).get("id");
    if (!showId) return;
    const host = this.host;
    try {
      const room = await api<CreatedRoom>("/api/rooms", {
        method: "POST",
        body: {
          provider: getSelectedProvider(),
          show_id: showId,
          episode_id: host.playbackType === "episode" ? host.playbackId : null,
          episode_label: host.playbackType === "episode" ? host.episodeLabel : null,
          content_type: host.playbackType === "episode" ? "episode" : "movie",
        },
      });
      if (this.disposed) return;
      // Just created it — no need to ask who we are.
      this.store.set({
        code: room.code,
        ownerId: room.ownerId,
        members: room.members,
        selfId: room.ownerId,
      });
      this.setRoomUrlParam(room.code);
      this.connectRoom(room.code);
      this.store.set({ panelOpen: true });
      this.showToast("Watch party started — share the code!");
    } catch (err) {
      this.showToast("Could not start watch party: " + (err as Error).message);
    }
  }

  async leaveWatchParty(): Promise<void> {
    const code = this.code;
    if (!code) return;
    try {
      await api(`/api/rooms/${encodeURIComponent(code)}/leave`, { method: "POST" });
    } catch {
      /* best-effort */
    }
    if (this.disposed) return;
    this.conn?.close();
    this.conn = null;
    this.resetRoom();
    this.showToast("Left the watch party.");
  }

  /** Owner only: ends the party for everyone, where leaving hands ownership on. */
  async closeWatchParty(): Promise<void> {
    const code = this.code;
    if (!code) return;
    if (!window.confirm("Close this watch party for everyone?")) return;
    try {
      await api(`/api/rooms/${encodeURIComponent(code)}`, { method: "DELETE" });
    } catch (err) {
      this.showToast("Could not close watch party: " + (err as Error).message);
      return;
    }
    if (this.disposed) return;
    this.conn?.close();
    this.conn = null;
    this.resetRoom();
    this.showToast("Watch party closed.");
  }

  /**
   * Joins (or reconnects to) ?room=CODE. Runs before the page picks an
   * episode, so the room's episode and position are what it picks — no flash
   * of the wrong one — and leaves `applyingRemoteState` set so that initial
   * pick isn't broadcast back; `releaseJoinGuard` ends that.
   */
  async initRoomJoin(): Promise<void> {
    const code = new URLSearchParams(window.location.search).get("room");
    if (!code) return;
    if (!getAccessToken()) {
      this.showToast("Log in to join the watch party.");
      return;
    }
    try {
      let room = await api<CreatedRoom>(`/api/rooms/${encodeURIComponent(code)}`).catch(() => null);
      if (!room || !room.isMember) {
        room = await api<CreatedRoom>(`/api/rooms/${encodeURIComponent(code)}/join`, { method: "POST" });
      }
      if (this.disposed) return;
      this.store.set({ code: room.code, ownerId: room.ownerId, members: room.members });
      this.syncProviderFromRoom(room.state.provider);
      void getSelfId().then((selfId) => this.store.set({ selfId }));

      this.host.setJoinTarget(
        room.state.contentType === "episode" && room.state.episodeId ? room.state.episodeId : null,
        room.state.positionSeconds || 0,
      );
      this.host.pendingRoomPause = !room.state.playing;
      this.applyingRemoteState = true;
      this.connectRoom(room.code);
    } catch (err) {
      this.showToast("Could not join watch party: " + ((err as Error)?.message || "room not found"));
    }
  }

  /** The initial episode/server pick has settled. */
  releaseJoinGuard(): void {
    if (this.code) this.applyingRemoteState = false;
  }
}
