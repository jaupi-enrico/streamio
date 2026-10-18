/**
 * Google's Cast sender SDK (cast_sender.js + the CAF framework), loaded once
 * per document and typed as far as this page uses it. Hand-written rather
 * than @types/chromecast-caf-sender, which drags in all of @types/chrome as
 * globals.
 */

export interface CastSessionApi {
  getCastDevice(): { friendlyName?: string } | null;
  addMessageListener(ns: string, listener: (ns: string, message: string) => void): void;
  removeMessageListener(ns: string, listener: (ns: string, message: string) => void): void;
  sendMessage(ns: string, payload: unknown): Promise<unknown>;
  loadMedia(request: unknown): Promise<unknown>;
}

export interface CastContextApi {
  setOptions(options: Record<string, unknown>): void;
  addEventListener(type: string, handler: (e: { castState?: string; sessionState?: string }) => void): void;
  removeEventListener(type: string, handler: (e: { castState?: string; sessionState?: string }) => void): void;
  getCastState(): string;
  getSessionState(): string;
  getCurrentSession(): CastSessionApi | null;
  requestSession(): Promise<unknown>;
  endCurrentSession(stopCasting: boolean): void;
}

export interface RemotePlayer {
  currentTime: number;
  duration: number;
  isPaused: boolean;
  isMuted: boolean;
  volumeLevel: number;
}

export interface RemotePlayerController {
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
  playOrPause(): void;
  muteOrUnmute(): void;
  setVolumeLevel(): void;
  seek(): void;
}

export interface CastFramework {
  CastContext: { getInstance(): CastContextApi };
  CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string };
  SessionState: { SESSION_STARTED: string; SESSION_RESUMED: string; SESSION_ENDED: string };
  CastState: { NO_DEVICES_AVAILABLE: string; CONNECTED: string };
  RemotePlayer: new () => RemotePlayer;
  RemotePlayerController: new (player: RemotePlayer) => RemotePlayerController;
  RemotePlayerEventType: Record<
    | "IS_CONNECTED_CHANGED"
    | "CURRENT_TIME_CHANGED"
    | "DURATION_CHANGED"
    | "IS_PAUSED_CHANGED"
    | "VOLUME_LEVEL_CHANGED"
    | "IS_MUTED_CHANGED"
    | "MEDIA_INFO_CHANGED"
    | "PLAYER_STATE_CHANGED",
    string
  >;
}

type Ctor = new (...args: never[]) => Record<string, unknown>;

export interface ChromeCastApi {
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
  Image: new (url: string) => Record<string, unknown>;
  media: {
    MediaInfo: new (contentId: string, contentType: string) => Record<string, unknown>;
    LoadRequest: new (mediaInfo: Record<string, unknown>) => Record<string, unknown>;
    Track: new (trackId: number, type: string) => Record<string, unknown>;
    TrackType: { TEXT: string };
    TextTrackType: { SUBTITLES: string };
    StreamType: { BUFFERED: string };
    HlsSegmentFormat?: { TS?: string };
    HlsVideoSegmentFormat?: { MPEG2_TS?: string };
    TvShowMediaMetadata: Ctor;
    MovieMediaMetadata: Ctor;
  };
}

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: { framework?: CastFramework };
    chrome?: { cast?: ChromeCastApi };
  }
}

const SENDER_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

let sdk: Promise<boolean> | null = null;

/**
 * Resolves true once the framework is usable. Loaded on the first watch page
 * of the document and kept: the SDK is a global that can't be unloaded.
 */
export function loadCastSdk(): Promise<boolean> {
  if (sdk) return sdk;
  sdk = new Promise((resolve) => {
    if (window.cast?.framework && window.chrome?.cast) {
      resolve(true);
      return;
    }
    window.__onGCastApiAvailable = (isAvailable) => resolve(isAvailable);
    const script = document.createElement("script");
    script.src = SENDER_URL;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return sdk;
}

let optionsSet = false;

/** setOptions is meant to be called once per document. */
export function configureCastContext(context: CastContextApi, options: Record<string, unknown>): void {
  if (optionsSet) return;
  optionsSet = true;
  context.setOptions(options);
}
