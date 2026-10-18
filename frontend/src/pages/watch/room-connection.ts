/**
 * WebSocket client for watch-party rooms — public/scripts/room-sync.js,
 * unchanged on the wire so old and new pages can share a room.
 *
 * Talks to /ws/rooms/:code (services/room-socket.service.ts). The token goes
 * in the query string: the WebSocket constructor can't set headers.
 */
import { getAccessToken } from "../../lib/auth";
import { oldPageHref, wsUrl } from "../../lib/base";

export interface RoomMember {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
  is_owner?: boolean;
}

/** The room's shared "now playing" state. */
export interface RoomState {
  provider?: string;
  showId?: string;
  episodeId?: string | null;
  episodeLabel?: string | null;
  contentType?: "episode" | "movie";
  playing?: boolean;
  positionSeconds?: number;
}

export interface RoomMessage {
  type: string;
  state?: RoomState;
  members?: RoomMember[];
  ownerId?: string;
  message?: string;
}

type RoomEvent = "state" | "state_update" | "presence" | "closed" | "error" | "open";

export class RoomConnection {
  readonly code: string;
  private ws: WebSocket | null = null;
  private listeners: Partial<Record<RoomEvent, ((msg: RoomMessage) => void)[]>> = {};
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private manuallyClosed = false;

  constructor(code: string) {
    this.code = code.toUpperCase();
  }

  on(event: RoomEvent, cb: (msg: RoomMessage) => void): this {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }

  private emit(event: string, payload: RoomMessage): void {
    for (const cb of this.listeners[event as RoomEvent] || []) cb(payload);
  }

  connect(): this {
    this.manuallyClosed = false;
    const token = getAccessToken();
    if (!token) {
      this.emit("error", { type: "error", message: "Not authenticated" });
      return this;
    }
    const ws = new WebSocket(wsUrl(`/ws/rooms/${encodeURIComponent(this.code)}?token=${encodeURIComponent(token)}`));
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit("open", { type: "open" });
    };
    ws.onmessage = (ev) => {
      let msg: RoomMessage;
      try {
        msg = JSON.parse(String(ev.data)) as RoomMessage;
      } catch {
        return;
      }
      if (msg?.type) this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      if (this.manuallyClosed) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows; the reconnect is scheduled there */
    };
    return this;
  }

  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /** Any subset of the room state; the server merges it. */
  sendState(payload: RoomState): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "state", payload }));
  }

  close(): void {
    this.manuallyClosed = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

/**
 * The link a guest opens. The watch page a guest opens. Through oldPageHref so a path-prefixed install keeps its
 * prefix (the vanilla link was root-relative).
 */
export function roomInviteUrl(code: string, showId: string, provider: string): string {
  const params = new URLSearchParams({ id: showId, room: code });
  if (provider) params.set("provider", provider);
  return `${location.origin}${oldPageHref(`/watch?${params.toString()}`)}`;
}
