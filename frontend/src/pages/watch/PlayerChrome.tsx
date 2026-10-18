/**
 * The custom player's markup — watch.html's control bar, OSD and shortcuts
 * modal, same ids and classes — driven by PlayerControls (controls.ts).
 *
 * The buttons do nothing until the controls are initialized, which happens
 * the first time a stream is shown: that is when the vanilla page bound them.
 */
import { Fragment, useLayoutEffect, useRef, useSyncExternalStore, type JSX, type RefObject } from "react";
import {
  IconFastForward,
  IconGauge,
  IconKeyboard,
  IconPause,
  IconPlay,
  IconRewind,
  IconSeek,
  IconSkipBack,
  IconSkipForward,
  IconSubtitles,
  IconTheater,
  IconVolumeMute,
  IconVolumeOn,
} from "../../components/icons/icons";
import type { ControlsSnapshot, OsdIcon, PlayerControls } from "./controls";
import { SPEED_STEPS } from "./logic/playback";
import { shortcutGroups } from "./logic/shortcuts";
import type { WatchSession } from "./session";
import { useStore } from "./store";
import type { UpNextSnapshot } from "./upnext";
import type { RoomSnapshot } from "./room";
import type { CastSnapshot } from "./cast";

const OSD_ICONS: Record<OsdIcon, () => JSX.Element> = {
  play: IconPlay,
  pause: IconPause,
  rewind: IconRewind,
  fastForward: IconFastForward,
  skipBack: IconSkipBack,
  skipForward: IconSkipForward,
  gauge: IconGauge,
  subtitles: IconSubtitles,
  theater: IconTheater,
  seek: IconSeek,
  volumeOn: IconVolumeOn,
  volumeMute: IconVolumeMute,
};

const IDLE: ControlsSnapshot = {
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

const noopSubscribe = (): (() => void) => () => {};

const UPNEXT_IDLE: UpNextSnapshot = { nextLabel: "Next episode", nextShown: false, skipLabel: "Skip Intro", skipShown: false };
export const ROOM_IDLE: RoomSnapshot = {
  code: null,
  members: [],
  ownerId: null,
  selfId: null,
  panelOpen: false,
  toast: { text: "", shown: false },
};
export const CAST_IDLE: CastSnapshot = { buttonDisplay: "none", connected: false, panelOpen: false, view: null };

export function useControls(controls: PlayerControls | null): ControlsSnapshot {
  return useSyncExternalStore(controls ? controls.subscribe : noopSubscribe, controls ? controls.getSnapshot : () => IDLE);
}

function VolumeGlyph({ icon }: { icon: ControlsSnapshot["volumeIcon"] }): JSX.Element {
  switch (icon) {
    case "mute":
      return (
        <>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      );
    case "low":
      return (
        <>
          <path d="M3 9v6h4l5 5V4L7 9H3z" />
          <path d="M23 9a7 7 0 0 1 0 6" />
        </>
      );
    case "high":
      return (
        <>
          <path d="M3 9v6h4l5 5V4L7 9H3z" />
          <path d="M23 9a7 7 0 0 1 0 6" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      );
    default:
      return <path d="M3 9v6h4l5 5V4L7 9H3z" />;
  }
}

export function PlayerChrome({
  session,
  containerRef,
}: {
  session: WatchSession | null;
  containerRef: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  const controls = session?.controls ?? null;
  const c = useControls(controls);
  // Every handler waits for init, as the vanilla bindings did — except the
  // prompts, the watch-party, Cast and download buttons, which the vanilla
  // page bound on load.
  const live = c.initialized ? controls : null;
  const up = useStore(session?.upNext.store, UPNEXT_IDLE);
  const room = useStore(session?.room.store, ROOM_IDLE);
  const cast = useStore(session?.cast.store, CAST_IDLE);

  const controlsRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const bufferedRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLSpanElement | null>(null);
  const durationRef = useRef<HTMLSpanElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreDropdownRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!controls) return;
    Object.assign(controls.ui, {
      container: containerRef.current,
      controls: controlsRef.current,
      bar: barRef.current,
      fill: fillRef.current,
      buffered: bufferedRef.current,
      tooltip: tooltipRef.current,
      current: currentRef.current,
      duration: durationRef.current,
      moreBtn: moreBtnRef.current,
      moreDropdown: moreDropdownRef.current,
    });
  }, [controls, containerRef]);

  const Osd = c.osd.icon ? OSD_ICONS[c.osd.icon] : null;

  return (
    <>
      {/* Feedback for actions with no visible control of their own (keyboard
          seeks, volume, speed). */}
      <div className={`player-osd${c.osd.shown ? " show" : ""}`} id="playerOsd">
        <span className="player-osd-icon" id="playerOsdIcon">
          {Osd && <Osd />}
        </span>
        <span className="player-osd-text" id="playerOsdText">
          {c.osd.text}
        </span>
      </div>

      <div className="player-controls" id="playerControls" ref={controlsRef}>
        <div className={`next-ep-prompt${up.nextShown ? " show" : ""}`} id="nextEpPrompt">
          <span id="nextEpLabel">{up.nextLabel}</span>
          <button id="nextEpBtn" onClick={() => session?.upNext.playNext()}>
            <svg className="icon-svg" viewBox="0 0 24 24">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>{" "}
            Play next
          </button>
          <button id="nextEpCancel" onClick={() => session?.upNext.cancelNext()}>
            ✕
          </button>
        </div>
        <div className={`skip-segment-prompt${up.skipShown ? " show" : ""}`} id="skipSegmentPrompt">
          <button id="skipSegmentBtn" onClick={() => session?.upNext.skip()}>
            {up.skipLabel}
          </button>
        </div>
        <div className="progress-container">
          <div className="progress-bar" id="progressBar" ref={barRef}>
            <div className="progress-buffered" id="progressBuffered" ref={bufferedRef} />
            <div className="progress-fill" id="progressFill" ref={fillRef}>
              <span className="progress-handle" />
            </div>
            <div className="progress-tooltip" id="progressTooltip" ref={tooltipRef}>
              0:00
            </div>
          </div>
          <div className="time-display">
            <span id="currentTime" ref={currentRef}>
              0:00
            </span>{" "}
            /{" "}
            <span id="duration" ref={durationRef}>
              0:00
            </span>
          </div>
        </div>
        <div className="controls-row">
          <div className="controls-left">
            <button className="pbtn" id="playBtn" title="Play/Pause" onClick={() => live?.togglePlayback()}>
              <svg viewBox="0 0 24 24">
                {c.playing ? (
                  <>
                    <line x1="6" y1="4" x2="6" y2="20" />
                    <line x1="18" y1="4" x2="18" y2="20" />
                  </>
                ) : (
                  <polygon points="5 3 19 12 5 21 5 3" />
                )}
              </svg>
            </button>
            <div className="volume-control">
              <button className="pbtn" id="volumeBtn" title="Mute" onClick={() => live?.toggleMute()}>
                <svg viewBox="0 0 24 24">
                  <VolumeGlyph icon={c.volumeIcon} />
                </svg>
              </button>
              <input
                type="range"
                id="volumeSlider"
                className="volume-slider"
                min="0"
                max="100"
                value={String(Math.round(c.volume * 100))}
                onChange={(e) => live?.setVolume(Number(e.target.value) / 100, false)}
              />
            </div>
          </div>
          <div className="controls-right">
            <button className="pbtn" id="shareBtn" title="Share" onClick={() => live && session?.shareCurrent()}>
              <svg viewBox="0 0 24 24">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            </button>
            <button
              className={`pbtn${room.code ? " active" : ""}`}
              id="roomBtn"
              title="Watch Party"
              onClick={() => session?.room.togglePanel()}
            >
              <svg viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </button>
            <button
              className="pbtn"
              id="castBtn"
              title="Cast to TV"
              style={{ display: cast.buttonDisplay, ...(cast.connected ? { color: "var(--red)" } : {}) }}
              onClick={() => session?.cast.onButtonClick()}
            >
              <svg viewBox="0 0 24 24">
                <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
                <line x1="2" y1="20" x2="2.01" y2="20" />
              </svg>
            </button>
            <button className="pbtn" id="pipBtn" title="Picture in Picture" onClick={() => void live?.togglePip()}>
              <svg viewBox="0 0 24 24">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" />
              </svg>
            </button>
            <button
              className={`pbtn${c.theater ? " active" : ""}`}
              id="theaterBtn"
              title="Theater mode (T)"
              onClick={() => live?.toggleTheater()}
            >
              <svg viewBox="0 0 24 24">
                <rect x="2" y="6" width="20" height="12" rx="2" />
              </svg>
            </button>
            <button className="pbtn" id="fullscreenBtn" title="Fullscreen (F)" onClick={() => live?.toggleFullscreen()}>
              <svg viewBox="0 0 24 24">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
            {/* Quality/subtitles/speed/download/shortcuts live behind one
                button so they don't crowd out the controls reached for
                constantly. */}
            <div className="more-menu">
              <button
                className="pbtn"
                id="moreBtn"
                title="More options"
                ref={moreBtnRef}
                onClick={(e) => {
                  if (!live) return;
                  e.stopPropagation();
                  live.toggleMore();
                }}
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <div className={`dropdown more-dropdown${c.moreOpen ? " show" : ""}`} id="moreDropdown" ref={moreDropdownRef}>
                <div className="more-section">
                  <div className="more-section-title">Quality</div>
                  <div className="more-section-list" id="qualityDropdown">
                    {c.quality?.rows.map((r) => (
                      <button
                        key={r.level}
                        className={`dropdown-btn${r.level === c.quality!.manual ? " active" : ""}`}
                        data-level={String(r.level)}
                        onClick={() => controls?.pickQuality(r.level)}
                      >
                        {r.level === -1 ? c.quality!.autoLabel : r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* #subtitleBtn is the "Subtitles" section wrapper, not an icon button. */}
                <div className="more-section" id="subtitleBtn" style={{ display: c.subtitles ? "block" : "none" }}>
                  <div className="more-section-title">Subtitles</div>
                  <div className="more-section-list" id="subtitleDropdown">
                    {c.subtitles?.rows.map((label, i) => (
                      <button
                        key={i}
                        className={`dropdown-btn${c.subtitles!.active[i] ? " active" : ""}`}
                        onClick={() => controls?.pickSubtitle(i)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="more-section">
                  <div className="more-section-title">Speed</div>
                  <div className="more-section-list speed-row" id="speedDropdown">
                    {c.initialized &&
                      SPEED_STEPS.map((speed) => (
                        <button
                          key={speed}
                          className={`dropdown-btn speed-chip${Math.abs(speed - c.rate) < 0.01 ? " active" : ""}`}
                          data-speed={String(speed)}
                          onClick={() => controls?.setRate(speed)}
                        >
                          {speed === 1 ? "Normal" : `${speed}×`}
                        </button>
                      ))}
                  </div>
                </div>
                <div className="more-section">
                  <div className="more-section-title">Download</div>
                  <div className="more-section-list" id="downloadDropdown">
                    <button className="dropdown-btn" onClick={() => void session?.download.download()}>
                      Download MP4
                    </button>
                  </div>
                </div>
                <div className="more-section">
                  <button className="dropdown-btn" id="helpBtn" onClick={() => live?.openHelp()}>
                    {/* Added on init, so the label reads without it. */}
                    {c.initialized && (
                      <>
                        <IconKeyboard />{" "}
                      </>
                    )}
                    Keyboard Shortcuts
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The help modal, rendered from the same table that binds the keys, so it
 * cannot list a key that does nothing or miss one that works.
 */
export function ShortcutsModal({ session }: { session: WatchSession | null }): JSX.Element {
  const controls = session?.controls ?? null;
  const c = useControls(controls);
  const close = (): void => controls?.closeShortcuts();
  return (
    <>
      <div className={`modal-overlay${c.shortcutsOpen ? " show" : ""}`} id="modalOverlay" onClick={close} />
      <div className={`shortcuts-modal${c.shortcutsOpen ? " show" : ""}`} id="shortcutsModal">
        <h3>
          Keyboard Shortcuts
          <button className="shortcuts-close" onClick={close}>
            ✕
          </button>
        </h3>
        <div className="shortcuts-body" id="shortcutsBody">
          {c.initialized &&
            controls &&
            shortcutGroups(controls.shortcuts).map((group) => (
              <section className="shortcuts-group" key={group.name}>
                <h4>{group.name}</h4>
                <div className="shortcuts-grid">
                  {group.items.map((item) => (
                    <div className="shortcut-item" key={item.keys.join()}>
                      <span className="shortcut-keys">
                        {item.keys.map((k, i) => (
                          <Fragment key={k}>
                            {i > 0 && <span className="shortcut-sep">/</span>}
                            <span className="key">{k}</span>
                          </Fragment>
                        ))}
                      </span>
                      <span className="shortcut-label">{item.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </>
  );
}
