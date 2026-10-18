/**
 * The two prompts over the control bar: "Skip Intro/Recap/Credits/Preview"
 * (TheIntroDB, through /api/intro-segments) and "Next episode" near the end.
 * A port of maybeShowNextEpPrompt / loadIntroSegments / maybeShowSkipSegment
 * and the button handlers around them in public/scripts/watch.js.
 *
 * Both are driven off the media element's timeupdate; neither shows while
 * casting — the receiver draws its own.
 */
import { fetchPublic } from "../../lib/auth";
import type { Preferences } from "../../lib/preferences";
import { getSelectedProvider } from "../../lib/provider-selection";
import type { EpisodeCard } from "./logic/episodes";
import {
  COMPLETE_TAIL,
  NEXT_EP_THRESHOLD,
  SKIP_SEGMENT_LABELS,
  findActiveSkipSegment,
  type ActiveSkipSegment,
  type IntroSegments,
} from "./logic/playback";
import { Store } from "./store";

/** What the prompts need from the page's session. */
export interface UpNextHost {
  readonly player: HTMLVideoElement;
  readonly prefs: Preferences;
  readonly casting: boolean;
  readonly playbackId: string;
  readonly playbackType: "episode" | "movie";
  readonly showId: string;
  readonly showTitle: string;
  readonly showImdbId: string;
  readonly showReleased: string;
  autoplayNextEnabled: boolean;
  /** The episode playing, if it is one. */
  currentEpisode(): EpisodeCard | undefined;
  /** The one after it in the whole show, if any. */
  nextEpisode(): EpisodeCard | undefined;
  playNextEpisode(): void;
  markCurrentPlaybackDone(): void;
}

export interface UpNextSnapshot {
  /** Keeps its last text while hidden, as the vanilla label did. */
  nextLabel: string;
  nextShown: boolean;
  skipLabel: string;
  skipShown: boolean;
}

/** The ids the intro lookup used — reused as hints in the Cast payload. */
export interface IntroDbIds {
  tmdbId: number | null;
  imdbId: string;
  year: number | null;
}

/**
 * TheIntroDB picks the release version (theatrical, extended, …) closest to
 * the duration it's given, so the lookup waits for the player to report one —
 * bounded, so a stream that never does is still looked up without the hint.
 */
const INTRO_DURATION_WAIT_MS = 15000;

function awaitPlayerDurationMs(player: HTMLVideoElement): Promise<number | null> {
  const read = (): number | null =>
    Number.isFinite(player.duration) && player.duration > 0 ? Math.round(player.duration * 1000) : null;
  const known = read();
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    const finish = (value: number | null): void => {
      clearTimeout(timer);
      player.removeEventListener("loadedmetadata", onChange);
      player.removeEventListener("durationchange", onChange);
      resolve(value);
    };
    const onChange = (): void => {
      const ms = read();
      if (ms) finish(ms);
    };
    const timer = setTimeout(() => finish(null), INTRO_DURATION_WAIT_MS);
    player.addEventListener("loadedmetadata", onChange);
    player.addEventListener("durationchange", onChange);
  });
}

export class UpNext {
  readonly store = new Store<UpNextSnapshot>({
    nextLabel: "Next episode",
    nextShown: false,
    skipLabel: "Skip Intro",
    skipShown: false,
  });

  private nextTimer: ReturnType<typeof setTimeout> | undefined;
  /** playbackId → segments (null: none, or the lookup failed). Saves a fetch per seek. */
  private introCache = new Map<string, IntroSegments | null>();
  private segments: IntroSegments | null = null;
  private skipActive: ActiveSkipSegment | null = null;
  introDbIds: IntroDbIds = { tmdbId: null, imdbId: "", year: null };

  constructor(private readonly host: UpNextHost) {}

  get nextPromptShown(): boolean {
    return this.store.state.nextShown;
  }

  dispose(): void {
    clearTimeout(this.nextTimer);
    this.store.close();
  }

  /** Per timeupdate, next to the progress bar's own update. */
  onTimeUpdate(): void {
    this.maybeShowNextEpPrompt();
    this.maybeShowSkipSegment();
  }

  /** A new stream was handed over: the old segments no longer apply. */
  onNewStream(): void {
    this.hideSkipSegment();
    void this.loadIntroSegments(); // fire-and-forget — must never delay stream start
  }

  // ── Next episode ──

  private maybeShowNextEpPrompt(): void {
    const { player, casting, playbackType } = this.host;
    if (casting) return;
    if (playbackType !== "episode") return;
    if (!player.duration || isNaN(player.duration)) return;

    const remaining = player.duration - player.currentTime;
    const nextEp = this.host.nextEpisode();
    if (remaining <= NEXT_EP_THRESHOLD && remaining > 0 && nextEp && !this.nextPromptShown) {
      this.showNextEpPrompt(nextEp);
    }
    // Hidden again when the viewer seeks back out of the threshold.
    if (remaining > NEXT_EP_THRESHOLD && this.nextPromptShown) this.hideNextEpPrompt();
  }

  private showNextEpPrompt(nextEp: EpisodeCard): void {
    this.store.set({ nextShown: true, nextLabel: `Next: S${nextEp.seasonNum}E${nextEp.episodeNum}` });
    // Advances on its own unless the viewer answers first.
    clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => {
      if (this.nextPromptShown) this.host.playNextEpisode();
    }, NEXT_EP_THRESHOLD * 1000);
  }

  hideNextEpPrompt(): void {
    clearTimeout(this.nextTimer);
    this.store.set({ nextShown: false });
  }

  /** "Play next". */
  playNext(): void {
    clearTimeout(this.nextTimer);
    this.host.playNextEpisode();
  }

  /** ✕ — opts out of autoplay for the rest of this page's life. */
  cancelNext(): void {
    this.host.autoplayNextEnabled = false;
    this.hideNextEpPrompt();
  }

  // ── Skip segments ──

  /**
   * Keyed by TMDB/IMDB id, so a title only resolves when the source published
   * one — without it there is nothing to look up and the button never shows.
   */
  private async loadIntroSegments(): Promise<void> {
    const host = this.host;
    this.segments = null;
    this.introDbIds = { tmdbId: null, imdbId: "", year: null };
    const cacheKey = host.playbackId;
    if (!cacheKey) return;

    if (this.introCache.has(cacheKey)) {
      this.segments = this.introCache.get(cacheKey) ?? null;
      return;
    }

    const showId = host.showId;
    const provider = getSelectedProvider();
    const title = host.showTitle;
    if (!showId || !provider || !title) {
      this.introCache.set(cacheKey, null);
      return;
    }

    // Show ids are opaque provider strings, never a TMDB id; only an IMDB id
    // the title carries feeds the lookup.
    const tmdbId = "";
    const imdbId = host.showImdbId;
    const year = host.showReleased ? new Date(host.showReleased).getFullYear() : "";
    this.introDbIds = { tmdbId: tmdbId ? Number(tmdbId) : null, imdbId, year: year || null };

    const ep = host.playbackType === "episode" ? host.currentEpisode() : undefined;
    if (host.playbackType === "episode" && !ep) {
      this.introCache.set(cacheKey, null);
      return;
    }

    // While casting the local element never gets the source; the receiver
    // runs its own lookup with the duration it knows.
    const durationMs = host.casting ? null : await awaitPlayerDurationMs(host.player);
    // Something else took over while this waited, and has its own call in flight.
    if (host.playbackId !== cacheKey) return;

    const qs = new URLSearchParams({ type: host.playbackType === "movie" ? "movie" : "tv" });
    if (tmdbId) qs.set("tmdbId", tmdbId);
    if (imdbId) qs.set("imdbId", imdbId);
    if (ep) {
      qs.set("season", String(ep.seasonNum));
      qs.set("episode", String(ep.episodeNum));
    }
    if (durationMs) qs.set("durationMs", String(durationMs));

    try {
      const res = await fetchPublic(`/api/intro-segments?${qs.toString()}`);
      const body = (await res.json()) as { data?: IntroSegments | null };
      const data = body?.data || null;
      this.introCache.set(cacheKey, data);
      if (host.playbackId === cacheKey) this.segments = data;
    } catch {
      this.introCache.set(cacheKey, null); // fail silent — never blocks playback
    }
  }

  private maybeShowSkipSegment(): void {
    const { player, casting } = this.host;
    if (casting || !this.segments) return;
    if (!player.duration || isNaN(player.duration)) return;
    // The next-episode prompt wins — the two never show together.
    if (this.nextPromptShown) {
      if (this.store.state.skipShown) this.hideSkipSegment();
      return;
    }
    const match = findActiveSkipSegment(this.segments, player.currentTime * 1000, player.duration * 1000);
    if (match) {
      if (!this.store.state.skipShown || this.skipActive?.type !== match.type) this.showSkipSegment(match);
    } else if (this.store.state.skipShown) {
      this.hideSkipSegment();
    }
  }

  private showSkipSegment(match: ActiveSkipSegment): void {
    this.skipActive = match;
    this.store.set({ skipShown: true, skipLabel: SKIP_SEGMENT_LABELS[match.type] || "Skip" });
    // Credits and previews stay manual: skipping them ends the episode, which
    // is the autoplay preference's call, not this one's.
    if (this.host.prefs.auto_skip_intro && (match.type === "intro" || match.type === "recap")) this.skip();
  }

  private hideSkipSegment(): void {
    this.skipActive = null;
    this.store.set({ skipShown: false });
  }

  /** The Skip button. */
  skip(): void {
    const player = this.host.player;
    const active = this.skipActive;
    if (!active) return;

    const target = active.end / 1000;
    // Credits/preview running to the end — or leaving less than COMPLETE_TAIL
    // after them, where a skip would land — mean the viewer is done with
    // what's loaded.
    const endsMedia =
      (active.type === "credits" || active.type === "preview") &&
      (active.runsToEnd || (player.duration && !isNaN(player.duration) && player.duration - target <= COMPLETE_TAIL));

    if (endsMedia) {
      this.hideSkipSegment();
      // Before playNextEpisode, which no-ops with autoplay off: the skip must
      // still mark the episode watched.
      this.host.markCurrentPlaybackDone();
      const hasNext = this.host.playbackType === "episode" && !!this.host.nextEpisode();
      if (hasNext && this.host.autoplayNextEnabled) {
        this.host.playNextEpisode();
      } else {
        // Movie, last episode or autoplay off: park at the end rather than
        // let the credits run on behind a dismissed button.
        player.currentTime = player.duration;
      }
      return;
    }

    player.currentTime = target;
    this.hideSkipSegment();
  }

  /** The S key: the same as the button, when one is showing. */
  skipIfShown(): void {
    if (!this.store.state.skipShown) return;
    this.skip();
  }
}
