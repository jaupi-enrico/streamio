/**
 * A title's details — a port of public/details.html + scripts/details.js.
 *
 * `show.details` is the provider's ShowDetails bag: every key optional, and a
 * missing one means "this source doesn't publish it" — each section below
 * drops its row rather than printing a placeholder. The facts table comes
 * from show-meta.ts, shared with the watch page.
 *
 * Deliberate differences from the vanilla page:
 *  - watchlist/favorite/rating are only looked up for a signed-in visitor.
 *    The vanilla page called them unconditionally, and a logged-out visitor
 *    was bounced to /login by the first one — browsing is meant to stay open.
 *  - a missing overview is dropped instead of "No description available."
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { IconFilm } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { BottomNav } from "../../components/layout/BottomNav";
import { TopNav } from "../../components/layout/TopNav";
import { useShareModal } from "../../components/social/ShareModal";
import { useLoadPreferences } from "../../hooks/usePreferences";
import { usePageScope } from "../../hooks/usePageScope";
import { useQuietSession } from "../../hooks/useQuietSession";
import { api, fetchPublic, getAccessToken } from "../../lib/auth";
import { pageHref } from "../../lib/pages";
import { getName as providerLabel } from "../../lib/provider-names";
import { getSelectedProvider, setSelectedProvider, withProvider } from "../../lib/provider-selection";
import { STAT_LABELS, ageLabel, formatDate, formatNumber, showFacts } from "../../lib/show-meta";
import type { ListItem, ShowDetails } from "../../lib/types";
import "./details.css";

interface Person {
  name?: string;
  image?: string | null;
}

interface SeasonLite {
  id?: string;
  title?: string | null;
  number?: number | null;
  episodeCount?: number | null;
  released?: string | null;
  overview?: string | null;
}

/** The show as `GET /api/shows/:id` serializes it — the fields read here. */
interface Show extends Omit<ListItem, "seasons"> {
  provider?: string;
  trailer?: string | null;
  directors?: Person[];
  cast?: Person[];
  seasons?: SeasonLite[];
  recommendations?: (ListItem & { provider?: string })[];
  details?: ShowDetails | null;
}

type ShowResponse =
  | { kind: "ok"; show: Show }
  | { kind: "gated"; preference: string }
  | { kind: "missing" };

const CTA_BTN: CSSProperties = { border: "1px solid rgba(255,255,255,0.25)", cursor: "pointer" };

// ── Header pieces ──

function Badges({ s }: { s: Show }): JSX.Element {
  const d = s.details || {};
  const stats = (d as { stats?: Record<string, number> }).stats;
  const age = ageLabel(d.ageRating);
  const audio = d.audio as { dubIta?: boolean; subIta?: boolean } | undefined;
  return (
    <div className="badge-row">
      {s.providerName && <span className="badge badge-red">{providerLabel(s.providerName)}</span>}
      {s.rating ? (
        <span className="badge badge-rating">
          ★ {String(s.rating)}
          {stats?.votes ? ` (${formatNumber(stats.votes)})` : ""}
        </span>
      ) : null}
      {d.contentType && <span className="badge badge-outline">{d.contentType}</span>}
      {s.quality && <span className="badge badge-outline">{s.quality}</span>}
      {d.status && <span className="badge badge-soft">{d.status}</span>}
      {/* A number is an age, a string a certificate — both print as-is. */}
      {age && <span className="badge badge-age">{age}</span>}
      {audio?.dubIta && <span className="badge badge-soft">ITA</span>}
      {audio?.subIta && <span className="badge badge-soft">SUB ITA</span>}
    </div>
  );
}

/** Original and alternative titles the source lists. */
function Subtitle({ s }: { s: Show }): JSX.Element | null {
  const d = s.details || {};
  const titles = [d.originalTitle, ...((d as { alternativeTitles?: string[] }).alternativeTitles || [])].filter(
    (t): t is string => Boolean(t) && t !== s.title,
  );
  const unique = [...new Set(titles)];
  if (!unique.length) return null;
  return <p className="detail-subtitle">{unique.join(" · ")}</p>;
}

function Backdrop({ s }: { s: Show }): JSX.Element | null {
  const banner = s.banner || "";
  const poster = s.poster || "";
  const [src, setSrc] = useState(banner || poster);
  if (!src) return null;
  return (
    <img
      id="backdropImg"
      src={src}
      alt=""
      onError={() => setSrc(src === banner && poster && poster !== banner ? poster : "")}
    />
  );
}

// ── Meta table ──

function MetaRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="meta-row">
      <span className="meta-key">{label}</span>
      <span className="meta-val">{children}</span>
    </div>
  );
}

function MetaTable({ s }: { s: Show }): JSX.Element {
  const d = s.details || {};
  const stats = (d as { stats?: Record<string, number> }).stats;
  const keywords = ((d as { keywords?: string[] }).keywords || []).filter(Boolean);
  const links = ((d as { externalLinks?: { label?: string; url?: string }[] }).externalLinks || []).filter(
    (l) => l && l.url && /^https?:\/\//.test(l.url),
  );
  const statChips = Object.entries(STAT_LABELS).flatMap(([key, label]) => {
    const value = formatNumber(stats?.[key]);
    return value ? [{ key, value, label }] : [];
  });

  // Most providers ship the id the browse wants; some parse genre names off
  // the page without one — those link by name, and /search resolves it.
  const genreProvider = s.provider || getSelectedProvider();
  const providerParam = genreProvider ? `&provider=${encodeURIComponent(genreProvider)}` : "";
  const genres = (s.genres || []).filter((g) => g && g.name);

  const rows: JSX.Element[] = [];
  if (s.title) rows.push(<MetaRow key="title" label="Titolo">{s.title}</MetaRow>);
  if (s.rating) rows.push(<MetaRow key="rating" label="Voto">★ {String(s.rating)}</MetaRow>);
  for (const f of showFacts(s)) rows.push(<MetaRow key={`f-${f.label}`} label={f.label}>{f.value}</MetaRow>);
  if (s.providerName) rows.push(<MetaRow key="provider" label="Provider">{providerLabel(s.providerName)}</MetaRow>);
  if (genres.length) {
    rows.push(
      <MetaRow key="genres" label="Generi">
        {genres.map((g, i) => {
          const target = g.id ? `genre=${encodeURIComponent(String(g.id))}` : `genreName=${encodeURIComponent(g.name ?? "")}`;
          return (
            <AppLink key={i} className="genre-tag" to={`/search?${target}${providerParam}`}>
              {g.name}
            </AppLink>
          );
        })}
      </MetaRow>,
    );
  }
  if (keywords.length) {
    rows.push(
      <MetaRow key="keywords" label="Tag">
        <span className="tag-wrap">
          {keywords.map((k, i) => (
            <span key={i} className="keyword-tag">
              {k}
            </span>
          ))}
        </span>
      </MetaRow>,
    );
  }
  if (statChips.length) {
    rows.push(
      <MetaRow key="stats" label="Statistiche">
        <span className="tag-wrap">
          {statChips.map((c) => (
            <span key={c.key} className="stat-chip">
              <b>{c.value}</b> {c.label}
            </span>
          ))}
        </span>
      </MetaRow>,
    );
  }
  if (links.length) {
    rows.push(
      <MetaRow key="links" label="Link">
        <span className="tag-wrap">
          {links.map((l, i) => (
            <a key={i} className="ext-tag" href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label || l.url}
            </a>
          ))}
        </span>
      </MetaRow>,
    );
  }

  return <div className="meta-table">{rows}</div>;
}

// ── Sections ──

/**
 * Cast and crew. Photos are whatever the source matched; a person without one
 * gets their initial.
 */
function PersonCard({ person, role }: { person: Person & { name: string }; role: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  return (
    <div className="person-card">
      <div className="person-avatar">
        {person.image && !failed ? (
          <img src={person.image} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          person.name.slice(0, 1).toUpperCase()
        )}
      </div>
      <div className="person-name">{person.name}</div>
      <div className="person-role">{role}</div>
    </div>
  );
}

function CastSection({ s }: { s: Show }): JSX.Element | null {
  const people = [
    ...(s.directors || []).map((p) => ({ person: p, role: "Regia" })),
    ...(s.cast || []).map((p) => ({ person: p, role: "Cast" })),
  ].filter((p): p is { person: Person & { name: string }; role: string } => Boolean(p.person?.name));
  if (!people.length) return null;
  return (
    <div id="castSection" style={{ display: "block" }}>
      <div className="detail-section">
        <h2 className="section-title">Cast</h2>
        <div className="people-rail" id="castRail">
          {people.map((p, i) => (
            <PersonCard key={i} person={p.person} role={p.role} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Seasons, informational only: /watch picks the season from its own selector
 * and takes no season parameter, so a per-season link would be one that
 * silently ignores which season was clicked.
 */
function SeasonsSection({ s }: { s: Show }): JSX.Element | null {
  const seasons = (s.seasons || []).filter((season) => season && season.id);
  if (!seasons.length) return null;
  return (
    <div id="seasonsSection" style={{ display: "block" }}>
      <div className="detail-section">
        <h2 className="section-title">Stagioni</h2>
        <div className="season-list" id="seasonList">
          {seasons.map((season) => {
            const label = season.title || (season.number ? `Stagione ${season.number}` : "Episodi");
            const meta = [season.episodeCount ? `${season.episodeCount} episodi` : "", formatDate(season.released) || ""]
              .filter(Boolean)
              .join(" · ");
            return (
              <div className="season-card" key={season.id}>
                <div className="season-name">{label}</div>
                {meta && <div className="season-meta">{meta}</div>}
                {season.overview && <p className="season-overview">{season.overview}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RecommendationsSection({ s }: { s: Show }): JSX.Element | null {
  const recs = s.recommendations || [];
  if (!recs.length) return null;
  return (
    <div id="recommendationsSection" style={{ display: "block" }}>
      <div className="recommendations-section">
        <h2 className="section-title">Raccomandati</h2>
        <div className="rec-grid" id="recGrid">
          {recs.map((r, i) => {
            const to = `/details?id=${encodeURIComponent(r.id)}&provider=${encodeURIComponent(r.provider || getSelectedProvider())}`;
            const year = r.released ? String(r.released).slice(0, 4) : "";
            const sub = [r.details?.contentType || "", year].filter(Boolean).join(" · ");
            return (
              <AppLink key={`${r.id}-${i}`} to={to} className="rec-card">
                {r.poster ? (
                  <img src={r.poster} alt={r.title || ""} loading="lazy" />
                ) : (
                  <div className="rec-card-placeholder">
                    <IconFilm />
                  </div>
                )}
                <div className="rec-card-info">
                  <div className="rec-card-title">{r.title || "Unknown"}</div>
                  {sub && <div className="rec-card-sub">{sub}</div>}
                  {r.rating ? <div className="rec-card-rating">★ {String(r.rating)}</div> : null}
                </div>
              </AppLink>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Rating modal ──

function RatingModal({
  current,
  onPick,
  onDelete,
  onClose,
}: {
  current: number | null;
  onPick: (n: number) => void;
  onDelete: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      id="ratingModal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.7)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "32px 28px",
          minWidth: 300,
          textAlign: "center",
        }}
      >
        <div
          style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "1.6rem", letterSpacing: "0.06em", marginBottom: 20 }}
        >
          Il tuo voto
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
            const on = current === n;
            return (
              <button
                key={n}
                onClick={() => onPick(n)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 5,
                  border: "1px solid var(--border)",
                  background: on ? "rgba(245,197,24,0.2)" : "var(--surface2)",
                  color: on ? "#f5c518" : "var(--text)",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  borderColor: on ? "rgba(245,197,24,0.5)" : "var(--border)",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        {current ? (
          <>
            <button
              onClick={onDelete}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: "0.82rem",
                textDecoration: "underline",
                marginBottom: 12,
              }}
            >
              Rimuovi voto
            </button>
            <br />
          </>
        ) : null}
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "0.85rem", marginTop: 4 }}
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

// ── Library state (watchlist / favorite / rating) ──

interface LibraryState {
  inWatchlist: boolean;
  favorite: boolean;
  rating: number | null;
}

async function loadLibraryState(provider: string, showId: string): Promise<LibraryState> {
  const p = encodeURIComponent(provider);
  const id = encodeURIComponent(showId);
  // Settled one by one, as on the vanilla page: the rating lookup answers 404
  // for a title never rated, and that must not cost the other two buttons
  // their state. The favourite and rating are only asked once the watchlist
  // answered, which is when the vanilla page asked them.
  const watchlist = await api<{ provider: string; show_id: string }[]>("/api/account/watchlist");
  const [fav, rating] = await Promise.all([
    api<{ favorite?: boolean }>(`/api/account/favorites/${p}/${id}`).catch(() => null),
    api<{ rating?: number | null }>(`/api/account/ratings/${p}/${id}`).catch(() => null),
  ]);
  return {
    inWatchlist: (watchlist || []).some((i) => i.provider === provider && i.show_id === showId),
    favorite: fav?.favorite === true,
    rating: rating?.rating ?? null,
  };
}

function DetailsBody({ show, showId }: { show: Show; showId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const openShare = useShareModal();
  const provider = show.provider || getSelectedProvider();
  const signedIn = Boolean(getAccessToken());
  const libKey = ["library-state", provider, showId];
  const library = useQuery({
    queryKey: libKey,
    queryFn: () => loadLibraryState(provider, showId),
    enabled: signedIn,
    retry: false,
  });
  const lib: LibraryState = library.data ?? { inWatchlist: false, favorite: false, rating: null };
  const setLib = (patch: Partial<LibraryState>) => queryClient.setQueryData(libKey, { ...lib, ...patch });

  const [busy, setBusy] = useState<string | null>(null);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [partyLabel, setPartyLabel] = useState("Watch Party");

  const p = encodeURIComponent(provider);
  const id = encodeURIComponent(showId);

  async function toggleWatchlist() {
    setBusy("wl");
    try {
      if (lib.inWatchlist) {
        await api(`/api/account/watchlist/${p}/${id}`, { method: "DELETE" });
        setLib({ inWatchlist: false });
      } else {
        await api("/api/account/watchlist", { method: "POST", body: { provider, show_id: showId } });
        setLib({ inWatchlist: true });
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleFavorite() {
    setBusy("fav");
    try {
      if (lib.favorite) {
        await api(`/api/account/favorites/${p}/${id}`, { method: "DELETE" });
        setLib({ favorite: false });
      } else {
        await api("/api/account/favorites", { method: "POST", body: { provider, show_id: showId } });
        setLib({ favorite: true });
      }
    } finally {
      setBusy(null);
    }
  }

  async function submitRating(n: number) {
    if (!n || n < 1 || n > 10) return;
    await api(`/api/account/ratings/${p}/${id}`, { method: "PUT", body: { rating: n } });
    setLib({ rating: n });
    setRatingOpen(false);
  }

  async function deleteRating() {
    await api(`/api/account/ratings/${p}/${id}`, { method: "DELETE" });
    setLib({ rating: null });
    setRatingOpen(false);
  }

  async function startWatchParty() {
    setPartyLabel("Starting…");
    try {
      const room = await api<{ code: string }>("/api/rooms", {
        method: "POST",
        body: { provider, show_id: showId },
      });
      const params = new URLSearchParams({ id: showId, room: room.code });
      if (provider) params.set("provider", provider);
      window.location.href = pageHref(`/watch?${params.toString()}`);
    } catch (err) {
      setPartyLabel("Watch Party");
      const message = err instanceof Error ? err.message : String(err);
      alert(message === "Not authenticated" ? "Log in to start a watch party." : `Could not start watch party: ${message}`);
    }
  }

  const wlStyle: CSSProperties = lib.inWatchlist
    ? { ...CTA_BTN, background: "rgba(70,211,105,0.15)", borderColor: "rgba(70,211,105,0.4)", color: "#46d369" }
    : CTA_BTN;
  const favStyle: CSSProperties = lib.favorite
    ? { ...CTA_BTN, background: "rgba(229,9,20,0.15)", borderColor: "rgba(229,9,20,0.4)", color: "var(--red)" }
    : CTA_BTN;
  const ratingStyle: CSSProperties = lib.rating
    ? { ...CTA_BTN, background: "rgba(245,197,24,0.15)", borderColor: "rgba(245,197,24,0.4)", color: "#f5c518" }
    : CTA_BTN;

  const watchPath = `/watch?id=${encodeURIComponent(show.id)}&provider=${encodeURIComponent(provider)}`;

  return (
    <>
      <div id="backdropSection">
        <div className="backdrop">
          <Backdrop key={show.id} s={show} />
          <div className="backdrop-gradient" />
          <div className="backdrop-content">
            <Badges s={show} />
            <h1 className="detail-title">{show.title || "Unknown"}</h1>
            <Subtitle s={show} />
            {show.overview ? <p className="detail-overview">{show.overview}</p> : null}
            <div className="cta-row">
              <a href={pageHref(watchPath)} className="btn-play">
                ▶ &nbsp;Play
              </a>
              <button id="wlBtn" className="btn-more" style={wlStyle} disabled={busy === "wl"} onClick={() => void toggleWatchlist()}>
                {lib.inWatchlist ? "✓ In Watchlist" : "＋ Watchlist"}
              </button>
              <button id="favBtn" className="btn-more" style={favStyle} disabled={busy === "fav"} onClick={() => void toggleFavorite()}>
                {lib.favorite ? "♥ Favorito" : "♡ Preferiti"}
              </button>
              <button id="ratingBtn" className="btn-more" style={ratingStyle} onClick={() => setRatingOpen(true)}>
                {lib.rating ? `★ ${lib.rating}/10` : "☆ Vota"}
              </button>
              <button
                id="shareBtn"
                className="btn-more"
                style={CTA_BTN}
                onClick={() =>
                  openShare({
                    provider,
                    show_id: showId,
                    summary: show.title ? `Sharing "${show.title}"` : undefined,
                  })
                }
              >
                Share
              </button>
              <button
                id="watchPartyBtn"
                className="btn-more"
                style={CTA_BTN}
                disabled={partyLabel !== "Watch Party"}
                onClick={() => void startWatchParty()}
              >
                {partyLabel}
              </button>
              {show.trailer ? (
                <a href={show.trailer} target="_blank" rel="noopener noreferrer" className="btn-more">
                  ▶ &nbsp;Trailer
                </a>
              ) : null}
              <AppLink to="/catalog" className="btn-more">
                ← &nbsp;Back
              </AppLink>
            </div>
          </div>
        </div>
      </div>

      <div className="details-panel" id="detailsPanel" style={{ display: "grid" }}>
        <div>
          <AppLink to="/catalog" className="back-link">
            ← Back to Catalog
          </AppLink>
          <div id="detailsMeta">
            <MetaTable s={show} />
          </div>
        </div>
      </div>

      <CastSection s={show} />
      <SeasonsSection s={show} />
      <RecommendationsSection s={show} />

      {ratingOpen && (
        <RatingModal
          current={lib.rating}
          onPick={(n) => void submitRating(n)}
          onDelete={() => void deleteRating()}
          onClose={() => setRatingOpen(false)}
        />
      )}
    </>
  );
}

function EmptyState({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div id="backdropSection">
      <div className="empty-state">{children}</div>
    </div>
  );
}

const LINK_STYLE: CSSProperties = { color: "var(--red)", textDecoration: "none", marginTop: 20, fontWeight: 600 };

export default function DetailsPage(): JSX.Element {
  useLoadPreferences();
  const [params] = useSearchParams();
  const showId = params.get("id");
  const providerParam = params.get("provider");
  const [scrolled, setScrolled] = useState(false);

  // The link's provider becomes the active one, as on the vanilla page.
  useEffect(() => {
    if (providerParam) setSelectedProvider(providerParam);
  }, [providerParam]);

  // A title can be 18+-gated, so the server has to know who is asking.
  const sessionReady = useQuietSession();

  const query = useQuery({
    queryKey: ["show-details", showId, providerParam],
    enabled: sessionReady && Boolean(showId),
    retry: false,
    queryFn: async (): Promise<ShowResponse> => {
      const res = await fetchPublic(
        withProvider(`/api/shows/${encodeURIComponent(showId ?? "")}`, providerParam || getSelectedProvider()),
      );
      const data = (await res.json()) as { data?: Show; preference?: string };
      // The server names which preference unlocks this one.
      if (res.status === 403) return { kind: "gated", preference: data.preference || "adult-all" };
      if (!res.ok || !data.data) return { kind: "missing" };
      return { kind: "ok", show: data.data };
    },
  });

  const title = query.data?.kind === "ok" ? `${query.data.show.title || "Details"} — Streamio` : "Streamio - Details";
  usePageScope("details", title);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  let body: JSX.Element;
  if (!showId) {
    body = (
      <EmptyState>
        <h2>No Show Selected</h2>
        <p>Please select a show from the catalog.</p>
        <AppLink to="/catalog" style={LINK_STYLE}>
          Browse Catalog →
        </AppLink>
      </EmptyState>
    );
  } else if (query.isError) {
    body = (
      <EmptyState>
        <h2>Error</h2>
        <p>{query.error.message}</p>
      </EmptyState>
    );
  } else if (!query.data) {
    body = (
      <EmptyState>
        <h2>Loading...</h2>
        <p>Fetching show details</p>
      </EmptyState>
    );
  } else if (query.data.kind === "gated") {
    body = (
      <EmptyState>
        <h2>Not Available</h2>
        <p>
          This title is flagged 18+. Enable <code>{query.data.preference}</code> on your account to view it.
        </p>
        <AppLink to="/account" style={LINK_STYLE}>
          Go to Preferences →
        </AppLink>
      </EmptyState>
    );
  } else if (query.data.kind === "missing") {
    body = (
      <EmptyState>
        <h2>Not Found</h2>
        <p>This show could not be found.</p>
      </EmptyState>
    );
  } else {
    body = <DetailsBody key={showId} show={query.data.show} showId={showId} />;
  }

  return (
    <>
      <TopNav id="navbar" omit={["rooms"]} className={scrolled ? "bg" : undefined} />
      {body}
      <BottomNav />
    </>
  );
}
