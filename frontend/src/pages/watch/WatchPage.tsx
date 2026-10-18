/**
 * The player page — a port of public/watch.html + scripts/watch.js.
 *
 * Split per the migration plan (§5): the imperative core is WatchSession
 * (session.ts) and PlayerEngine (player-engine.ts), created once per mount
 * and read here through a snapshot. The markup is watch.html's, ids and
 * classes unchanged, so the verbatim stylesheet applies as-is.
 *
 * Around the session: the player controls (controls.ts, PlayerChrome), the
 * skip/next-episode prompts (upnext.ts), watch parties (room.ts), Cast
 * (cast.ts) and download (download.ts), each with its own snapshot; their
 * panels are in Panels.tsx.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type MouseEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router";
import { AppLink } from "../../components/layout/AppLink";
import { usePageScope } from "../../hooks/usePageScope";
import { getName as providerLabel } from "../../lib/provider-names";
import { STAT_LABELS, ageLabel, formatNumber, showFacts } from "../../lib/show-meta";
import {
  episodeBadges,
  episodeLabel,
  episodeProgressWidth,
  episodeStateClass,
  episodeTitle,
  seasonTabs,
  visibleEpisodes,
  type EpisodeCard,
} from "./logic/episodes";
import { PlayerChrome, ShortcutsModal } from "./PlayerChrome";
import { WatchPanels } from "./Panels";
import { WatchSession, type WatchShow, type WatchSnapshot } from "./session";
import { useShareModal } from "../../components/social/ShareModal";
import "./watch.css";

/** What the page shows before the session exists (and under StrictMode's first mount). */
function useSession(videoRef: RefObject<HTMLVideoElement | null>, showId: string): WatchSession | null {
  const [session, setSession] = useState<WatchSession | null>(null);
  const openShare = useShareModal();
  const openShareRef = useRef(openShare);
  openShareRef.current = openShare;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const s = new WatchSession(video, showId);
    s.flush = (fn) => flushSync(fn);
    s.openShare = (content) => openShareRef.current(content);
    setSession(s);
    void s.start();
    return () => {
      s.dispose();
      setSession((cur) => (cur === s ? null : cur));
    };
  }, [videoRef, showId]);
  return session;
}

const noopSubscribe = (): (() => void) => () => {};

function useSnapshot(session: WatchSession | null, fallback: WatchSnapshot): WatchSnapshot {
  return useSyncExternalStore(session ? session.subscribe : noopSubscribe, session ? session.getSnapshot : () => fallback);
}

/** A remount per title: one session never outlives the show it loaded. */
export default function WatchPage(): JSX.Element {
  const [params] = useSearchParams();
  const id = params.get("id") || "";
  return <WatchView key={id} showId={id} />;
}

const EMPTY: WatchSnapshot = {
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

function WatchView({ showId }: { showId: string }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const session = useSession(videoRef, showId);
  const snap = useSnapshot(session, EMPTY);
  const title = snap.show ? `${snap.show.title || "Watch"} — Streamio` : "Streamio - Watch";
  usePageScope("watch", title);

  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onScroll = (): void => {
      navRef.current?.classList.toggle("solid", window.scrollY > 10);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const shown = snap.playerShown;
  return (
    <>
      <nav id="navbar" ref={navRef}>
        <AppLink to="/" className="brand">
          STREAMIO
        </AppLink>
        <AppLink to={snap.showId ? `/details?id=${encodeURIComponent(snap.showId)}` : "/details"} className="back-btn" id="backBtn">
          ← Back
        </AppLink>
      </nav>

      {/* PLAYER */}
      <div className="player-section">
        <div className="player-container" id="playerContainer" ref={containerRef}>
          <div
            className="player-placeholder"
            id="playerPlaceholder"
            style={shown === null ? undefined : { display: shown ? "none" : "flex" }}
          >
            {snap.placeholder === null ? (
              <>
                <div className="spinner" />
                <p>Loading...</p>
              </>
            ) : (
              <p>{snap.placeholder}</p>
            )}
          </div>
          <video
            id="videoPlayer"
            playsInline
            ref={videoRef}
            style={shown === null ? undefined : { display: shown ? "block" : "none" }}
          />
          <PlayerChrome session={session} containerRef={containerRef} />
        </div>
      </div>

      <WatchPanels session={session} />
      <ShortcutsModal session={session} />

      {/* CONTENT */}
      <div className="content-area">
        <ShowHeader heading={snap.heading} show={snap.show} />
        <MetaStrip show={snap.show} />
        <div id="errorMsg">{snap.error && <div className="error-msg">{snap.error}</div>}</div>

        <NowPlaying ep={snap.nowPlaying} />

        <div className="section" id="episodesSection" style={{ display: snap.episodesSection ? "block" : "none" }}>
          <div className="section-title">Episodes</div>
          <EpisodeNav session={session} snap={snap} />
          <EpisodeGrid session={session} snap={snap} />
        </div>

        <div className="section">
          <div className="section-title">Servers</div>
          <div className="btn-grid" id="serversGrid">
            {snap.serversNotice ? (
              <p style={snap.serversNotice.error ? ERROR_TEXT : MUTED_TEXT}>{snap.serversNotice.text}</p>
            ) : (
              snap.servers.map((s, i) => (
                <button
                  key={i}
                  className={`srvbtn${snap.activeServer === i ? " active" : ""}`}
                  onClick={(e) => session?.playServer(i, e.currentTarget)}
                >
                  {s.name || s.server || "Server " + (i + 1)}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const MUTED_TEXT = { color: "var(--muted)", fontSize: "0.88rem" } as const;
const ERROR_TEXT = { color: "#ff6b6b", fontSize: "0.88rem" } as const;

// ── Show header ──

function ShowHeader({ heading, show }: { heading: string; show: WatchShow | null }): JSX.Element {
  const d = show?.details || {};
  const stats = (d as { stats?: Record<string, number> }).stats;
  const audio = d.audio as { dubIta?: boolean; subIta?: boolean } | undefined;
  const age = ageLabel(d.ageRating);

  // Original/alternative titles, where they differ from the one displayed.
  const alternatives = [d.originalTitle, ...((d as { alternativeTitles?: string[] }).alternativeTitles || [])].filter(
    (t): t is string => Boolean(t) && t !== show?.title,
  );
  const subtitle = [...new Set(alternatives)].join(" · ");
  const links = ((d as { externalLinks?: { label?: string; url?: string }[] }).externalLinks || []).filter(
    (l) => l && l.url && /^https?:\/\//.test(l.url),
  );

  return (
    <div className="content-header" id="contentHeader">
      <h1 className="content-title" id="contentTitle">
        {heading}
      </h1>
      <div className="content-subtitle" id="contentSubtitle" hidden={!subtitle}>
        {subtitle}
      </div>
      <div className="content-badges" id="contentBadges">
        {show && (
          <>
            {show.providerName && <span className="content-badge cb-red">{providerLabel(show.providerName)}</span>}
            {show.rating ? (
              <span className="content-badge cb-yellow">
                ★ {String(show.rating)}
                {stats?.votes ? ` (${formatNumber(stats.votes)})` : ""}
              </span>
            ) : null}
            {d.contentType && <span className="content-badge cb-outline">{d.contentType}</span>}
            {show.quality && <span className="content-badge cb-outline">{show.quality}</span>}
            {d.status && <span className="content-badge cb-outline">{d.status}</span>}
            {age && <span className="content-badge cb-red">{age}</span>}
            {audio?.dubIta && <span className="content-badge cb-outline">ITA</span>}
            {audio?.subIta && <span className="content-badge cb-outline">SUB ITA</span>}
          </>
        )}
      </div>
      <p className="content-overview" id="contentOverview" hidden={!show?.overview}>
        {show?.overview || ""}
      </p>
      <div className="content-links" id="contentLinks" hidden={!links.length}>
        {links.map((l, i) => (
          <a key={i} className="content-link" href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label || l.url}
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * The fact chips. What a title's facts are comes from show-meta (shared with
 * the details page); a fact the source doesn't publish is dropped.
 */
function MetaStrip({ show }: { show: WatchShow | null }): JSX.Element {
  const chips: { l: string; v: string }[] = [];
  if (show) {
    const stats = (show.details as { stats?: Record<string, number> } | null | undefined)?.stats;
    if (show.rating) chips.push({ l: "Voto", v: `★ ${show.rating}` });
    if (show.providerName) chips.push({ l: "Provider", v: providerLabel(show.providerName) });
    for (const f of showFacts(show)) chips.push({ l: f.label, v: String(f.value) });
    if (show.genres?.length)
      chips.push({
        l: "Generi",
        v: show.genres
          .map((g) => g.name)
          .slice(0, 3)
          .join(", "),
      });
    for (const [key, label] of Object.entries(STAT_LABELS)) {
      const value = formatNumber(stats?.[key]);
      if (value) chips.push({ l: label, v: value });
    }
  }
  return (
    <div className="meta-strip" id="contentMeta">
      {chips.map((c, i) => (
        <div className="meta-chip" key={i}>
          <div className="mc-label">{c.l}</div>
          <div className="mc-val">{c.v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Episodes ──

/**
 * The selected episode in full — thumbnail, title and plot the grid can only
 * show clipped. Hidden when the source gives nothing beyond a number.
 */
function NowPlaying({ ep }: { ep: EpisodeCard | null }): JSX.Element {
  const title = ep ? episodeTitle(ep) : "";
  const badges = ep ? episodeBadges(ep) : [];
  const hidden = !ep || (!title && !ep.overview && !ep.poster && !badges.length);
  return (
    <div className="now-playing" id="nowPlaying" hidden={hidden}>
      <img className="now-playing-thumb" id="nowPlayingThumb" alt="" hidden={!ep?.poster} src={ep?.poster || undefined} />
      <div className="now-playing-body">
        <div className="now-playing-label" id="nowPlayingLabel">
          {ep ? episodeLabel(ep) : ""}
        </div>
        <div className="now-playing-title" id="nowPlayingTitle">
          {title}
        </div>
        <div className="now-playing-badges" id="nowPlayingBadges">
          {badges.join(" · ")}
        </div>
        <p className="now-playing-overview" id="nowPlayingOverview">
          {ep?.overview || ""}
        </p>
      </div>
    </div>
  );
}

function EpisodeNav({ session, snap }: { session: WatchSession | null; snap: WatchSnapshot }): JSX.Element {
  const tabs = snap.show && snap.gridRendered ? seasonTabs(snap.show.seasons || [], snap.episodes) : [];
  const hidden = !snap.gridRendered || (snap.episodes.length < 2 && (snap.show?.seasons || []).length < 2);
  return (
    <div className="episode-nav" id="episodeNav" hidden={hidden}>
      <div className="episode-seasons" id="episodeSeasons">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`season-tab ${snap.view.seasonId === t.id ? "active" : ""}`}
            data-season-id={t.id}
            onClick={() => session?.setView({ seasonId: t.id })}
          >
            {t.label}
            {t.count ? <span className="season-tab-count">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="episode-tools">
        <input
          type="search"
          id="episodeFilter"
          className="episode-filter"
          placeholder="Cerca episodio…"
          autoComplete="off"
          aria-label="Filtra episodi per numero o titolo"
          value={snap.view.query}
          onChange={(e) => {
            const query = e.target.value;
            // A query searches the whole show, not the open season.
            session?.setView(query.trim() ? { query, seasonId: "all" } : { query });
          }}
        />
        <button
          type="button"
          className="episode-density"
          id="episodeDensity"
          aria-pressed={snap.gridRendered ? snap.view.compact : undefined}
          onClick={() => session?.setView({ compact: !snap.view.compact })}
        >
          {snap.gridRendered ? (snap.view.compact ? "Dettagli" : "Compatta") : ""}
        </button>
      </div>
    </div>
  );
}

/**
 * The visible slice of the episode list. Selection, watched state and the
 * progress bar are derived here from the session — no code path finds a
 * button by its position. The buttons register themselves by id for the one
 * thing that needs the element: scrolling to it.
 */
function EpisodeGrid({ session, snap }: { session: WatchSession | null; snap: WatchSnapshot }): JSX.Element {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useLayoutEffect(() => {
    if (!session) return;
    session.episodeButton = (id) => buttons.current.get(id) ?? null;
  }, [session]);

  const current = snap.episodes[snap.episodeIndex];
  const episodes = snap.gridRendered ? visibleEpisodes(snap.episodes, snap.view) : [];
  const spoilers = session?.prefs.hide_spoilers ?? false;
  const register = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(id, el);
    else buttons.current.delete(id);
  };

  return (
    <>
      <div className={snap.gridRendered ? (snap.view.compact ? "episode-list compact" : "episode-list") : "btn-grid"} id="episodesGrid">
        {snap.episodesNotice ? (
          <p style={snap.episodesNotice.error ? ERROR_TEXT : MUTED_TEXT}>{snap.episodesNotice.text}</p>
        ) : (
          episodes.map((ep) => {
            const state = episodeStateClass(snap.progress, ep.id);
            const cls = `epbtn ${snap.view.compact ? "epchip" : "epcard"} ${state}${ep.id === current?.id ? " active" : ""}`;
            const width = episodeProgressWidth(snap.progress, ep.id);
            const onClick = (e: MouseEvent<HTMLButtonElement>): void => void session?.selectEpisode(ep, e.currentTarget);
            return snap.view.compact ? (
              <EpisodeChip key={ep.id} ep={ep} cls={cls} width={width} onClick={onClick} ref={register(ep.id)} />
            ) : (
              <EpisodeCardButton
                key={ep.id}
                ep={ep}
                cls={cls}
                width={width}
                spoilerFree={spoilers && !state}
                onClick={onClick}
                ref={register(ep.id)}
              />
            );
          })
        )}
      </div>
      <p className="episode-empty" id="episodeEmpty" hidden={!snap.gridRendered || episodes.length > 0}>
        Nessun episodio corrisponde.
      </p>
    </>
  );
}

interface EpisodeButtonProps {
  ep: EpisodeCard;
  cls: string;
  width: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  ref: (el: HTMLButtonElement | null) => void;
}

/**
 * One episode card. Still a `button.epbtn` with `data-episode-id` and an
 * `.epbtn-progress` child, as on the vanilla page, for both densities.
 */
function EpisodeCardButton({ ep, cls, width, spoilerFree, onClick, ref }: EpisodeButtonProps & { spoilerFree: boolean }): JSX.Element {
  const title = episodeTitle(ep);
  const badges = episodeBadges(ep);
  // Episodes not yet started keep only their number and title when the
  // viewer asked to be spared spoilers.
  const overview = spoilerFree ? "" : ep.overview;
  const [broken, setBroken] = useState(false);
  return (
    <button className={cls} data-episode-id={ep.id} onClick={onClick} ref={ref}>
      <span className="epcard-thumb">
        {ep.poster && !spoilerFree ? (
          // The vanilla onerror removed the image and left the box empty.
          broken ? null : (
            <img className="epcard-thumb-img" src={ep.poster} alt="" loading="lazy" onError={() => setBroken(true)} />
          )
        ) : (
          <span className="epcard-thumb-num">{String(ep.episodeNum)}</span>
        )}
      </span>
      <span className="epcard-body">
        <span className="epbtn-label">{episodeLabel(ep)}</span>
        {title && <span className="epcard-title">{title}</span>}
        {badges.length ? <span className="epcard-badges">{badges.join(" · ")}</span> : null}
        {overview && <span className="epcard-overview">{overview}</span>}
      </span>
      <span className="epbtn-progress" style={width ? { width } : undefined} />
    </button>
  );
}

/** The compact form: the number alone, the rest in its tooltip and the now-playing panel. */
function EpisodeChip({ ep, cls, width, onClick, ref }: EpisodeButtonProps): JSX.Element {
  const label = episodeLabel(ep);
  const title = episodeTitle(ep);
  return (
    <button className={cls} data-episode-id={ep.id} title={title ? `${label} · ${title}` : label} onClick={onClick} ref={ref}>
      <span className="epbtn-label">{String(ep.episodeNum)}</span>
      <span className="epbtn-progress" style={width ? { width } : undefined} />
    </button>
  );
}
