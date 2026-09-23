/**
 * The custom player chrome — the "Player actions", on-screen feedback,
 * keyboard, scrubbing, auto-hide and Media Session parts of
 * public/scripts/watch.js (initPlayerControls and the functions around it).
 *
 * Two kinds of state, kept apart on purpose:
 *  - what React renders (play/volume icons, the menus, theater, OSD, the
 *    shortcuts modal) is a snapshot read through useSyncExternalStore and
 *    changes a few times per interaction;
 *  - what moves every frame (progress fill, clock, buffered range, the scrub
 *    tooltip) and the container's show-controls/is-fullscreen classes are
 *    written straight to elements the component registers in `ui`, like the
 *    vanilla page did, so playback never re-renders the page.
 *
 * Wired on first `init()` — the vanilla page bound everything the first time
 * a stream was shown, so before that no key does anything, not even `?`.
 */
import type Hls from "hls.js";
import type { Preferences } from "../../lib/preferences";
import { SPEED_STEPS, formatTime, qualityRows, steppedRate, type QualityRow } from "./logic/playback";
import { buildShortcuts, findShortcut, type Shortcut } from "./logic/shortcuts";

/** What the controls need from the page's session. */
export interface ControlsHost {
  readonly player: HTMLVideoElement;
  readonly prefs: Preferences;
  readonly hls: Hls | null;
  /** Whether the <video> is on screen (not the placeholder). */
  readonly playerVisible: boolean;
  goEpisode(delta: number): void;
  skipSegment(): void;
  mediaTitle(): string;
  mediaArtwork(): string[];
}

export type OsdIcon =
  | "play"
  | "pause"
  | "rewind"
  | "fastForward"
  | "skipBack"
  | "skipForward"
  | "gauge"
  | "subtitles"
  | "theater"
  | "seek"
  | "volumeOn"
  | "volumeMute";

export interface SubtitleMenu {
  /** Row 0 is "Off". */
  rows: string[];
  active: boolean[];
}

export interface ControlsSnapshot {
  initialized: boolean;
  /** Drives the play button's glyph; flips only on the element's play/pause events. */
  playing: boolean;
  volume: number;
  /** Null until the first sync: the markup's own single-path speaker shows. */
  volumeIcon: "mute" | "low" | "high" | null;
  rate: number;
  quality: { rows: QualityRow[]; manual: number; autoLabel: string } | null;
  /** Null hides the Subtitles section. */
  subtitles: SubtitleMenu | null;
  theater: boolean;
  moreOpen: boolean;
  shortcutsOpen: boolean;
  osd: { icon: OsdIcon | null; text: string; shown: boolean };
}

const INITIAL: ControlsSnapshot = {
  initialized: false,
  playing: false,
  volume: 1,
  volumeIcon: null,
  rate: 1,
  quality: null,
  subtitles: null,
  theater: false,
  moreOpen: false,
  shortcutsOpen: false,
  osd: { icon: null, text: "", shown: false },
};

export const VOLUME_STORAGE_KEY = "streamio.player.volume";
export const MUTED_STORAGE_KEY = "streamio.player.muted";
export const THEATER_STORAGE_KEY = "streamio.player.theater";
const KEY_REPEAT_MS = 120;

/** The elements the chrome writes to directly. */
export interface ControlsUi {
  container: HTMLElement | null;
  controls: HTMLElement | null;
  bar: HTMLElement | null;
  fill: HTMLElement | null;
  buffered: HTMLElement | null;
  tooltip: HTMLElement | null;
  current: HTMLElement | null;
  duration: HTMLElement | null;
  moreBtn: HTMLElement | null;
  moreDropdown: HTMLElement | null;
}

export class PlayerControls {
  private snap: ControlsSnapshot = INITIAL;
  private listeners = new Set<() => void>();
  private cleanups: (() => void)[] = [];
  private disposed = false;
  private osdTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private pointerOverControls = false;
  private lastKeyAt = 0;
  private mediaSessionBound = false;
  /** A drag owns the bar until it's released. */
  isScrubbing = false;

  readonly ui: ControlsUi = {
    container: null,
    controls: null,
    bar: null,
    fill: null,
    buffered: null,
    tooltip: null,
    current: null,
    duration: null,
    moreBtn: null,
    moreDropdown: null,
  };

  readonly shortcuts: Shortcut[];

  constructor(private readonly host: ControlsHost) {
    this.shortcuts = buildShortcuts(this, () => this.host.prefs.seek_step);
  }

  // ── Store plumbing ──

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControlsSnapshot => this.snap;

  private set(patch: Partial<ControlsSnapshot>): void {
    if (this.disposed) return;
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private get player(): HTMLVideoElement {
    return this.host.player;
  }

  private on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    target.addEventListener(type, fn as EventListener);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener));
  }

  private onDocument<K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void): void {
    document.addEventListener(type, fn as EventListener);
    this.cleanups.push(() => document.removeEventListener(type, fn as EventListener));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.osdTimer);
    clearTimeout(this.hideTimer);
    for (const c of this.cleanups) c();
    this.cleanups = [];
    // Theater lives on <body>; it must not outlive the page.
    document.body.classList.remove("theater");
    this.listeners.clear();
  }

  // ── Actions (bar and keys both land here) ──

  /** A finite, seekable duration, or 0 for live/not-yet-loaded media. */
  duration(): number {
    const d = this.player.duration;
    return d && !isNaN(d) && isFinite(d) ? d : 0;
  }

  seekTo(seconds: number): void {
    const d = this.duration();
    if (!d) return;
    this.player.currentTime = Math.min(Math.max(seconds, 0), d);
  }

  seekBy(delta: number): void {
    if (!this.duration()) return;
    this.seekTo(this.player.currentTime + delta);
    this.showOsd(delta > 0 ? "fastForward" : "rewind", `${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`);
  }

  seekToFraction(fraction: number): void {
    const d = this.duration();
    if (!d) return;
    this.seekTo(d * fraction);
    this.showOsd("seek", `${Math.round(fraction * 100)}%`);
  }

  togglePlayback(): void {
    const player = this.player;
    if (player.paused) {
      player.play()?.catch(() => {});
      this.showOsd("play", "Play");
    } else {
      player.pause();
      this.showOsd("pause", "Pause");
    }
  }

  setVolume(volume: number, announce = true): void {
    const player = this.player;
    const v = Math.min(Math.max(volume, 0), 1);
    player.volume = v;
    // Nudging the volume up off zero unmutes — otherwise the slider moves
    // and nothing is heard, which reads as a broken player.
    if (v > 0 && player.muted) player.muted = false;
    this.syncVolume();
    this.persistVolume();
    if (announce) this.showOsd(v === 0 ? "volumeMute" : "volumeOn", `${Math.round(v * 100)}%`);
  }

  adjustVolume(delta: number): void {
    this.setVolume(this.player.volume + delta);
  }

  toggleMute(): void {
    const player = this.player;
    player.muted = !player.muted;
    this.syncVolume();
    this.persistVolume();
    this.showOsd(player.muted ? "volumeMute" : "volumeOn", player.muted ? "Muted" : "Unmuted");
  }

  private persistVolume(): void {
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(this.player.volume));
      localStorage.setItem(MUTED_STORAGE_KEY, this.player.muted ? "1" : "0");
    } catch {
      /* private mode / storage disabled — volume just won't be remembered */
    }
  }

  private restoreVolume(): void {
    const player = this.player;
    try {
      const stored = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? "");
      if (!isNaN(stored)) player.volume = Math.min(Math.max(stored, 0), 1);
      player.muted = localStorage.getItem(MUTED_STORAGE_KEY) === "1";
    } catch {
      /* ignore */
    }
    this.syncVolume();
  }

  /** Slider position + speaker icon, from whatever the element now holds. */
  syncVolume(): void {
    const player = this.player;
    const volumeIcon = player.muted || player.volume === 0 ? "mute" : player.volume < 0.5 ? "low" : "high";
    if (this.snap.volume !== player.volume || this.snap.volumeIcon !== volumeIcon)
      this.set({ volume: player.volume, volumeIcon });
  }

  setRate(rate: number): void {
    const player = this.player;
    player.playbackRate = Math.min(Math.max(rate, SPEED_STEPS[0]!), 2);
    this.syncRate();
    this.showOsd("gauge", `${player.playbackRate}×`);
  }

  /** Steps through SPEED_STEPS so the menu and the keys can never disagree. */
  stepRate(direction: number): void {
    this.setRate(steppedRate(this.player.playbackRate, direction));
  }

  private syncRate(): void {
    if (this.snap.rate !== this.player.playbackRate) this.set({ rate: this.player.playbackRate });
  }

  toggleFullscreen(): void {
    if (!document.fullscreenElement) this.ui.container?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }

  async togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.player.requestPictureInPicture();
    } catch (e) {
      console.warn("PiP failed", e);
    }
  }

  /**
   * Theater widens the player to the viewport and pushes the episode grid
   * below the fold. Persisted: it's a viewing preference, not a per-title one.
   */
  toggleTheater(force?: boolean): void {
    const on = force ?? !document.body.classList.contains("theater");
    document.body.classList.toggle("theater", on);
    this.set({ theater: on });
    try {
      localStorage.setItem(THEATER_STORAGE_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (force === undefined) this.showOsd("theater", on ? "Theater mode" : "Normal size");
  }

  /** Next entry in the subtitle menu, wrapping back to "Off". */
  cycleSubtitles(): void {
    const menu = this.snap.subtitles;
    if (!menu || !menu.rows.length) {
      this.showOsd("subtitles", "No subtitles");
      return;
    }
    const activeIdx = menu.active.findIndex(Boolean);
    const next = (activeIdx + 1) % menu.rows.length;
    this.pickSubtitle(next);
    this.showOsd("subtitles", menu.rows[next] || "Subtitles");
  }

  skipSegment(): void {
    this.host.skipSegment();
  }

  goEpisode(delta: number): void {
    this.host.goEpisode(delta);
  }

  /** Escape unwinds one layer at a time, innermost first. */
  escape(): void {
    if (this.snap.shortcutsOpen) this.closeShortcuts();
    else if (this.snap.moreOpen) this.set({ moreOpen: false });
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.body.classList.contains("theater")) this.toggleTheater(false);
  }

  // ── Menus and the shortcuts modal ──

  toggleMore(): void {
    this.set({ moreOpen: !this.snap.moreOpen });
  }

  showShortcuts(): void {
    this.set({ shortcutsOpen: true });
  }

  closeShortcuts(): void {
    this.set({ shortcutsOpen: false });
  }

  toggleShortcuts(): void {
    if (this.snap.shortcutsOpen) this.closeShortcuts();
    else this.showShortcuts();
  }

  /** The help row in the More menu. */
  openHelp(): void {
    this.set({ moreOpen: false, shortcutsOpen: true });
  }

  // ── On-screen feedback ──

  showOsd(icon: OsdIcon, text: string): void {
    this.set({ osd: { icon, text, shown: true } });
    clearTimeout(this.osdTimer);
    this.osdTimer = setTimeout(() => this.set({ osd: { ...this.snap.osd, shown: false } }), 900);
  }

  // ── Quality ──
  // The active row is `manualLevel`, never `currentLevel`: in auto mode
  // hls.js reports the level ABR is playing there, which made the highlight
  // hop between rows and never sit on "Auto".

  updateQualityMenu(): void {
    const hls = this.host.hls;
    if (!hls) return;
    this.set({ quality: { rows: qualityRows(hls.levels), manual: -1, autoLabel: "Auto" } });
    this.updateQualityStyle();
  }

  updateQualityStyle(): void {
    const hls = this.host.hls;
    const quality = this.snap.quality;
    if (!hls || !quality) return;
    const manual = hls.manualLevel;
    const playing = hls.currentLevel;
    // In auto mode, say which rendition ABR settled on.
    const lvl = manual === -1 && playing >= 0 ? hls.levels[playing] : null;
    const autoLabel = lvl && lvl.height ? `Auto (${lvl.height}p)` : "Auto";
    if (quality.manual !== manual || quality.autoLabel !== autoLabel)
      this.set({ quality: { ...quality, manual, autoLabel } });
  }

  pickQuality(level: number): void {
    // The vanilla row kept a reference to the stream it was built for; once
    // that stream is gone the click had nothing to act on.
    const hls = this.host.hls;
    if (!hls) return;
    hls.currentLevel = level;
    this.updateQualityStyle();
  }

  // ── Subtitles ──

  /** Rebuilds the menu from the element's text tracks and hls.js's subtitle renditions. */
  updateSubtitleMenu(): void {
    const textTracks = [...this.player.textTracks];
    const hls = this.host.hls;
    const hlsSubs = hls?.subtitleTracks || [];
    if (!textTracks.length && !hlsSubs.length) {
      this.set({ subtitles: null });
      return;
    }
    // "Off" starts unhighlighted, as on the vanilla page; only a pick marks it.
    const rows = ["Off"];
    const active = [false];
    textTracks.forEach((t, idx) => {
      rows.push(t.label || t.language || `Track ${idx + 1}`);
      active.push(t.mode === "showing");
    });
    hlsSubs.forEach((t, idx) => {
      rows.push(t.name || t.lang || `Sub ${idx + 1}`);
      active.push(hls!.subtitleTrack === idx);
    });
    this.set({ subtitles: { rows, active } });
  }

  pickSubtitle(row: number): void {
    const menu = this.snap.subtitles;
    if (!menu) return;
    const textTracks = [...this.player.textTracks];
    const hls = this.host.hls;
    if (row === 0) {
      textTracks.forEach((t) => (t.mode = "hidden"));
      if (hls) hls.subtitleTrack = -1;
    } else if (row - 1 < textTracks.length) {
      textTracks.forEach((t) => (t.mode = "hidden"));
      textTracks[row - 1]!.mode = "showing";
    } else if (hls) {
      hls.subtitleTrack = row - 1 - textTracks.length;
      hls.subtitleDisplay = true;
    }
    this.set({ subtitles: { ...menu, active: menu.rows.map((_, i) => i === row) } });
  }

  // ── Progress bar ──

  updateProgress(): void {
    const p = this.player;
    if (!p.duration) return;
    // A drag owns the bar until it's released — repainting from currentTime
    // mid-scrub snaps the handle back to the playhead under the cursor.
    if (this.isScrubbing) return;
    const { fill, current, duration } = this.ui;
    if (fill) fill.style.width = (p.currentTime / p.duration) * 100 + "%";
    if (current) current.textContent = formatTime(p.currentTime);
    if (duration) duration.textContent = formatTime(p.duration);
    this.updateBufferedBar();
  }

  /**
   * The buffered range around the playhead. Only that one: after a seek
   * `buffered` holds disjoint ranges, and the last one would claim
   * everything between them is downloaded.
   */
  updateBufferedBar(): void {
    const p = this.player;
    const bar = this.ui.buffered;
    if (!bar || !p.duration) return;
    let end = 0;
    for (let i = 0; i < p.buffered.length; i++) {
      if (p.buffered.start(i) <= p.currentTime && p.buffered.end(i) >= p.currentTime) {
        end = p.buffered.end(i);
        break;
      }
    }
    bar.style.width = `${Math.min((end / p.duration) * 100, 100)}%`;
  }

  // Pointer events, so a click and a drag are the same gesture: the seek is
  // committed on release, and only the preview moves while the pointer is
  // down (seeking on every move restarts the HLS fetch dozens of times).

  private positionFromEvent(e: PointerEvent): number {
    const r = this.ui.bar!.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  }

  private previewAt(fraction: number): void {
    const d = this.duration();
    if (!d) return;
    if (this.ui.fill) this.ui.fill.style.width = fraction * 100 + "%";
    if (this.ui.current) this.ui.current.textContent = formatTime(fraction * d);
  }

  private showTooltipAt(fraction: number): void {
    const d = this.duration();
    const tip = this.ui.tooltip;
    if (!d || !tip) return;
    tip.textContent = formatTime(fraction * d);
    tip.style.left = fraction * 100 + "%";
    tip.classList.add("show");
  }

  private wireScrubbing(bar: HTMLElement): void {
    const tip = (): HTMLElement | null => this.ui.tooltip;
    this.on(bar, "pointermove", (e) => {
      if (!this.isScrubbing) this.showTooltipAt(this.positionFromEvent(e));
    });
    this.on(bar, "pointerleave", () => {
      if (!this.isScrubbing) tip()?.classList.remove("show");
    });
    this.on(bar, "pointerdown", (e) => {
      if (!this.duration()) return;
      e.preventDefault();
      this.isScrubbing = true;
      bar.classList.add("scrubbing");
      bar.setPointerCapture(e.pointerId);
      const fraction = this.positionFromEvent(e);
      this.previewAt(fraction);
      this.showTooltipAt(fraction);
    });
    this.on(bar, "pointermove", (e) => {
      if (!this.isScrubbing) return;
      const fraction = this.positionFromEvent(e);
      this.previewAt(fraction);
      this.showTooltipAt(fraction);
    });
    const endScrub = (e: PointerEvent): void => {
      if (!this.isScrubbing) return;
      this.isScrubbing = false;
      bar.classList.remove("scrubbing");
      tip()?.classList.remove("show");
      this.seekTo(this.positionFromEvent(e) * this.duration());
      this.updateProgress();
    };
    this.on(bar, "pointerup", endScrub);
    this.on(bar, "pointercancel", endScrub);
  }

  // ── Auto-hide ──
  // Fullscreen keeps the mouse "hovering" the container forever, so CSS
  // :hover alone never hides the bar.

  /** 0 = never hide while playing, for viewers who need longer to reach a button. */
  private hideDelay(): number {
    return this.host.prefs.controls_timeout * 1000;
  }

  showControlsUI(): void {
    this.ui.container?.classList.add("show-controls");
    clearTimeout(this.hideTimer);
    if (!this.hideDelay()) return;
    this.hideTimer = setTimeout(() => {
      if (!this.player.paused && !this.pointerOverControls) this.ui.container?.classList.remove("show-controls");
    }, this.hideDelay());
  }

  private hideControlsUI(): void {
    clearTimeout(this.hideTimer);
    this.ui.container?.classList.remove("show-controls");
  }

  // ── Wiring ──

  /** Binds everything, once — the first time a stream is shown. */
  init(): void {
    if (this.snap.initialized || this.disposed) return;
    const player = this.player;
    const container = this.ui.container;
    const controls = this.ui.controls;
    this.set({ initialized: true });

    this.on(player, "play", () => this.set({ playing: true }));
    this.on(player, "pause", () => this.set({ playing: false }));
    this.on(player, "durationchange", () => this.updateProgress());
    this.on(player, "timeupdate", () => this.updateProgress());
    this.on(player, "progress", () => this.updateBufferedBar());
    this.on(player, "ratechange", () => this.syncRate());
    // Volume can also change from the OS mixer or a hardware key, which
    // never goes through setVolume — keep the slider honest either way.
    this.on(player, "volumechange", () => this.syncVolume());

    this.restoreVolume();
    this.syncRate();
    try {
      if (localStorage.getItem(THEATER_STORAGE_KEY) === "1") this.toggleTheater(true);
    } catch {
      /* ignore */
    }

    if (this.ui.bar) this.wireScrubbing(this.ui.bar);

    // Leaving fullscreen with the browser's own Esc/F11 must still update it.
    this.onDocument("fullscreenchange", () =>
      container?.classList.toggle("is-fullscreen", !!document.fullscreenElement),
    );

    this.onDocument("click", (e) => {
      if (!this.snap.moreOpen) return;
      const target = e.target as Node | null;
      if (this.ui.moreDropdown?.contains(target) || this.ui.moreBtn?.contains(target)) return;
      this.set({ moreOpen: false });
    });

    this.onDocument("keydown", (e) => this.onKeyDown(e));

    if (container && controls) this.wirePointer(container, controls);
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Never claim a browser/OS chord (Ctrl+R, Cmd+L, ...).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const active = document.activeElement as HTMLElement | null;
    const activeTag = active?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT" || active?.isContentEditable) return;
    // Space/Enter on a focused button is that button's own activation key —
    // an episode card must not toggle playback instead of opening.
    if ((activeTag === "BUTTON" || activeTag === "A") && (e.code === "Space" || e.code === "Enter")) return;

    const shortcut = findShortcut(this.shortcuts, e);
    if (!shortcut) return;
    // Single-key shortcuts can collide with screen readers and voice control
    // (WCAG 2.1.4), so they can be turned off — all but Esc and the help list.
    if (!this.host.prefs.keyboard_shortcuts && !shortcut.anytime) return;
    // Everything else needs a player on screen.
    if (!shortcut.anytime && !this.host.playerVisible) return;

    e.preventDefault();
    // Held arrow keys fire far faster than a seek can settle.
    const now = Date.now();
    if (e.repeat && now - this.lastKeyAt < KEY_REPEAT_MS) return;
    this.lastKeyAt = now;

    shortcut.run(e);
    // A seek already confirms itself through the OSD; whether it should also
    // bring up the whole bar is the viewer's call.
    if (shortcut.group !== "Seeking" || this.host.prefs.controls_on_seek) this.showControlsUI();
  }

  private wirePointer(container: HTMLElement, controls: HTMLElement): void {
    const player = this.player;
    // Touch devices have no real hover state, so they get tap-to-toggle.
    const isTouchDevice = window.matchMedia("(hover: none), (pointer: coarse)").matches;

    if (!isTouchDevice) {
      // Bound to the <video>, not the container, so clicks on the controls
      // overlay keep doing only what their button says.
      this.on(player, "click", (e) => {
        e.preventDefault();
        this.togglePlayback();
        this.showControlsUI();
      });
      // The two clicks before a double-click toggle playback twice and cancel out.
      this.on(player, "dblclick", (e) => {
        e.preventDefault();
        this.toggleFullscreen();
      });
      // Re-read off every move's own target rather than tracked with
      // mouseenter/leave: going fullscreen moves the bar out from under a
      // still cursor, no mouseleave arrives, and the bar never hid again.
      // The bar's own box is excluded — its gradient padding reaches well
      // above the buttons.
      this.on(container, "mousemove", (e) => {
        this.pointerOverControls = e.target !== controls && controls.contains(e.target as Node);
        this.showControlsUI();
      });
      this.on(container, "mouseenter", () => this.showControlsUI());
      this.on(container, "mouseleave", () => {
        this.pointerOverControls = false;
        clearTimeout(this.hideTimer);
        if (!player.paused && this.hideDelay()) container.classList.remove("show-controls");
      });
      this.onDocument("fullscreenchange", () => {
        this.pointerOverControls = false;
        this.showControlsUI();
      });
    } else {
      // Taps on the controls themselves are left alone.
      this.on(container, "click", (e) => {
        if (controls.contains(e.target as Node)) {
          this.showControlsUI();
          return;
        }
        if (container.classList.contains("show-controls")) this.hideControlsUI();
        else this.showControlsUI();
      });
    }
    this.on(player, "pause", () => {
      container.classList.add("show-controls");
      clearTimeout(this.hideTimer);
    });
    this.on(player, "play", () => this.showControlsUI());
    this.showControlsUI();

    // ── Mobile gestures ──
    let lastTap = 0;
    this.on(container, "touchend", (e) => {
      const now = Date.now();
      const rect = container.getBoundingClientRect();
      const x = e.changedTouches[0]!.clientX - rect.left;
      if (now - lastTap < 300) this.seekBy(x < rect.width / 2 ? -10 : 10);
      lastTap = now;
    });

    let touchStartY: number | null = null;
    let startVolume = 1;
    this.on(container, "touchstart", (e) => {
      touchStartY = e.touches[0]!.clientY;
      startVolume = player.volume;
    });
    this.on(container, "touchmove", (e) => {
      if (touchStartY === null) return;
      const dy = touchStartY - e.touches[0]!.clientY;
      const rect = container.getBoundingClientRect();
      const x = e.touches[0]!.clientX - rect.left;
      if (x > rect.width / 2) this.setVolume(startVolume + dy / 200, false);
    });
    this.on(container, "touchend", () => {
      touchStartY = null;
    });
  }

  // ── Media Session (OS media keys, lock screen, media hub) ──

  updateMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    const player = this.player;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.host.mediaTitle(),
        artist: "Streamio",
        artwork: this.host.mediaArtwork().map((src) => ({ src })),
      });
    } catch {
      /* MediaMetadata unavailable — the action handlers still work */
    }
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void player.play()?.catch(() => {})],
      ["pause", () => player.pause()],
      ["seekbackward", (d) => this.seekBy(-(d?.seekOffset || 10))],
      ["seekforward", (d) => this.seekBy(d?.seekOffset || 10)],
      ["seekto", (d) => void (d?.seekTime != null && this.seekTo(d.seekTime))],
      ["previoustrack", () => this.goEpisode(-1)],
      ["nexttrack", () => this.goEpisode(1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* action unsupported by this browser — skip it */
      }
    }
    if (this.mediaSessionBound) return;
    this.mediaSessionBound = true;
    this.cleanups.push(() => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* ignore */
        }
      }
    });
  }
}
