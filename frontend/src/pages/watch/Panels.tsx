/**
 * The watch page's side panels and toasts: the watch-party panel, the Cast
 * control panel and the download progress toast — watch.html's markup, ids
 * and classes unchanged, filled from each controller's snapshot.
 *
 * Other members' names and avatars render as JSX text and attributes; the
 * vanilla page escaped them into innerHTML.
 */
import { useLayoutEffect, useRef, type JSX } from "react";
import { IconCrown, IconPause, IconPlay, IconVolumeMute, IconVolumeOn } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { getSelectedProvider } from "../../lib/provider-selection";
import { CAST_IDLE, ROOM_IDLE } from "./PlayerChrome";
import type { CastController, CastPanelView } from "./cast";
import type { Downloader, DownloadSnapshot } from "./download";
import type { RoomSync } from "./room";
import { roomInviteUrl } from "./room-connection";
import type { WatchSession } from "./session";
import { useStore } from "./store";

export function WatchPanels({ session }: { session: WatchSession | null }): JSX.Element {
  return (
    <>
      <RoomPanel room={session?.room ?? null} />
      <CastPanel cast={session?.cast ?? null} />
      <DownloadToast download={session?.download ?? null} />
    </>
  );
}

// ── Watch party ──

function RoomPanel({ room }: { room: RoomSync | null }): JSX.Element {
  const r = useStore(room?.store, ROOM_IDLE);
  const isOwner = Boolean(r.selfId && r.ownerId && r.selfId === r.ownerId);
  const showId = new URLSearchParams(window.location.search).get("id") || "";

  return (
    <>
      <div className={`room-panel${r.panelOpen ? " show" : ""}`} id="roomPanel">
        <div className="room-panel-header">
          <span>Watch Party</span>
          <button className="room-panel-close" id="roomPanelClose" onClick={() => room?.closePanel()}>
            ✕
          </button>
        </div>
        <div className="room-panel-body" id="roomPanelBody">
          {!r.code ? (
            <>
              <p className="room-hint">
                Start a watch party to watch this title in sync with friends — everyone's play, pause, seek and episode
                changes stay in step.
              </p>
              <button className="room-btn" id="roomStartBtn" onClick={() => void room?.startWatchParty()}>
                Start Watch Party
              </button>
              <p className="room-hint">
                {"Got a code? "}
                <AppLink to="/rooms" style={{ color: "var(--red)" }}>
                  Join a watch party
                </AppLink>
                .
              </p>
            </>
          ) : (
            <>
              <div className="room-code-row">
                <span className="room-code">{r.code}</span>
                <button
                  className="room-btn room-copy-btn"
                  id="roomCopyCodeBtn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(r.code!);
                    room?.showToast("Code copied.");
                  }}
                >
                  Copy
                </button>
              </div>
              <button
                className="room-btn outline"
                id="roomCopyLinkBtn"
                onClick={() => {
                  void navigator.clipboard?.writeText(roomInviteUrl(r.code!, showId, getSelectedProvider()));
                  room?.showToast("Invite link copied.");
                }}
              >
                Copy invite link
              </button>
              <div className="room-members">
                <div className="room-members-title">{r.members.length} watching</div>
                {r.members.map((m) => (
                  <div className="room-member" key={m.id}>
                    <div className="room-member-avatar">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} />
                      ) : (
                        (m.display_name || "?").trim().charAt(0).toUpperCase() || "?"
                      )}
                    </div>
                    <span className="room-member-name">
                      {m.display_name || "Member"}
                      {m.id === r.selfId ? " (you)" : ""}
                    </span>
                    {m.is_owner && (
                      <span className="room-member-crown" title="Host">
                        <IconCrown />
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="room-btn outline"
                id="roomLeaveBtn"
                style={{ marginTop: "18px" }}
                onClick={() => void room?.leaveWatchParty()}
              >
                Leave Watch Party
              </button>
              {isOwner && (
                <button className="room-btn danger" id="roomCloseBtn" onClick={() => void room?.closeWatchParty()}>
                  Close Watch Party
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className={`room-toast${r.toast.shown ? " show" : ""}`} id="roomToast">
        {r.toast.text}
      </div>
    </>
  );
}

// ── Cast ──

/**
 * The selects, the volume slider and the autoplay box are set imperatively
 * after each render, as renderCastPanel did: a value the viewer just picked
 * stays until the receiver's next report says otherwise, and the slider is
 * left alone while it's being dragged.
 */
function useCastInputs(view: CastPanelView | null) {
  const episodeSelect = useRef<HTMLSelectElement | null>(null);
  const subtitleSelect = useRef<HTMLSelectElement | null>(null);
  const audioSelect = useRef<HTMLSelectElement | null>(null);
  const volume = useRef<HTMLInputElement | null>(null);
  const autoplay = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (!view) return;
    if (volume.current && document.activeElement !== volume.current) volume.current.value = String(view.volume);
    if (autoplay.current) autoplay.current.checked = view.autoplayNext;
    if (episodeSelect.current && view.episodeIndex >= 0) episodeSelect.current.value = String(view.episodeIndex);
    if (subtitleSelect.current && view.activeTrackId != null) subtitleSelect.current.value = String(view.activeTrackId);
    if (audioSelect.current && view.activeAudioTrackId != null) audioSelect.current.value = String(view.activeAudioTrackId);
  });
  return { episodeSelect, subtitleSelect, audioSelect, volume, autoplay };
}

function CastPanel({ cast }: { cast: CastController | null }): JSX.Element {
  const c = useStore(cast?.store, CAST_IDLE);
  const v = c.view;
  const inputs = useCastInputs(v);

  return (
    <div className={`cast-panel${c.panelOpen ? " show" : ""}`} id="castPanel">
      <div className="cast-panel-header">
        <span id="castDeviceName">{v ? v.deviceTitle : "Casting"}</span>
        <button className="room-panel-close" id="castPanelClose" onClick={() => cast?.closePanel()}>
          ✕
        </button>
      </div>
      <div className="cast-panel-body">
        <div className="cast-now">
          <img
            id="castNowPoster"
            alt=""
            src={v?.poster || undefined}
            style={v ? { display: v.poster ? "" : "none" } : undefined}
          />
          <div className="cast-now-text">
            <div className="cast-now-title" id="castNowTitle">
              {v?.title}
            </div>
            <div className="cast-now-sub" id="castNowSub">
              {v?.sub}
            </div>
          </div>
        </div>
        <div className="cast-seek">
          <div
            className="cast-bar"
            id="castBar"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              cast?.seekToFraction((e.clientX - rect.left) / rect.width);
            }}
          >
            <div id="castBarFill" style={v ? { width: v.fill } : undefined} />
          </div>
          <div className="cast-times">
            <span id="castElapsed">{v ? v.elapsed : "0:00"}</span>
            <span id="castDuration">{v ? v.duration : "0:00"}</span>
          </div>
        </div>
        <div className="cast-row">
          <button className="cast-ctl" id="castPrevBtn" title="Previous episode" onClick={() => cast?.previousEpisode()}>
            <svg className="icon-svg" viewBox="0 0 24 24">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>
          <button className="cast-ctl" id="castBack10Btn" title="Back 10 seconds" onClick={() => cast?.seekBy(-10)}>
            <svg className="icon-svg" viewBox="0 0 24 24">
              <polygon points="11 19 2 12 11 5 11 19" />
              <polygon points="22 19 13 12 22 5 22 19" />
            </svg>
          </button>
          <button className="cast-ctl cast-ctl-main" id="castPlayBtn" title="Play / pause" onClick={() => cast?.playOrPause()}>
            {v?.paused ? <IconPlay /> : <IconPause />}
          </button>
          <button className="cast-ctl" id="castFwd10Btn" title="Forward 10 seconds" onClick={() => cast?.seekBy(10)}>
            <svg className="icon-svg" viewBox="0 0 24 24">
              <polygon points="13 19 22 12 13 5 13 19" />
              <polygon points="2 19 11 12 2 5 2 19" />
            </svg>
          </button>
          <button className="cast-ctl" id="castNextBtn" title="Next episode" onClick={() => cast?.nextEpisode()}>
            <svg className="icon-svg" viewBox="0 0 24 24">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>
        <button
          className="room-btn"
          id="castSkipSegmentBtn"
          hidden={!v?.skipLabel}
          onClick={() => cast?.skipSegment()}
        >
          {v?.skipLabel || "Skip"}
        </button>
        <div className="cast-row cast-volume-row">
          <button className="cast-ctl" id="castMuteBtn" title="Mute" onClick={() => cast?.muteOrUnmute()}>
            {v?.muted ? <IconVolumeMute /> : <IconVolumeOn />}
          </button>
          <input
            type="range"
            id="castVolume"
            min="0"
            max="100"
            defaultValue="100"
            ref={inputs.volume}
            onInput={(e) => cast?.setVolume(Number(e.currentTarget.value) / 100)}
          />
        </div>
        <label className="cast-toggle">
          <input
            type="checkbox"
            id="castAutoplayNext"
            defaultChecked
            ref={inputs.autoplay}
            onChange={(e) => cast?.setAutoplay(e.target.checked)}
          />
          Autoplay next episode
        </label>
        <select
          className="cast-select"
          id="castEpisodeSelect"
          ref={inputs.episodeSelect}
          style={v && !v.episodes.length ? { display: "none" } : undefined}
          onChange={(e) => cast?.playEpisode(Number(e.target.value))}
        >
          {v?.episodes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="cast-select"
          id="castSubtitleSelect"
          ref={inputs.subtitleSelect}
          style={v && !v.subtitles.length ? { display: "none" } : undefined}
          onChange={(e) => cast?.setSubtitle(Number(e.target.value))}
        >
          {v?.subtitles.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* Audio renditions come back from the receiver; fewer than two
            hides the picker, as an empty one reads as broken. */}
        <select
          className="cast-select"
          id="castAudioSelect"
          ref={inputs.audioSelect}
          hidden={!v || v.audio.length < 2}
          onChange={(e) => cast?.setAudioTrack(Number(e.target.value))}
        >
          {v?.audio.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button className="room-btn danger" id="castDisconnectBtn" onClick={() => cast?.disconnect()}>
          Stop casting
        </button>
      </div>
    </div>
  );
}

// ── Download ──

const DOWNLOAD_IDLE: DownloadSnapshot = { toastShown: false, status: "0%", barWidth: null };

function DownloadToast({ download }: { download: Downloader | null }): JSX.Element {
  const d = useStore(download?.store, DOWNLOAD_IDLE);
  return (
    <div className={`download-toast${d.toastShown ? " show" : ""}`} id="downloadToast">
      <div className="download-toast-title">
        <span>Downloading...</span>
        <button className="toast-close" onClick={() => download?.closeToast()}>
          ✕
        </button>
      </div>
      <div className="download-bar">
        <div className="download-bar-fill" id="downloadBarFill" style={d.barWidth ? { width: d.barWidth } : undefined} />
      </div>
      <div className="download-status" id="downloadStatus">
        {d.status}
      </div>
    </div>
  );
}
