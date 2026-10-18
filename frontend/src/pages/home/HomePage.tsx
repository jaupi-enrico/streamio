/**
 * Home — a port of public/home.html + scripts/home.js: hero carousel, source
 * picker, Continue Watching (across every source) and the provider's rows.
 *
 * Boot order matters and is kept: restore the session (18+ and the provider
 * list depend on who asks), settle the active provider — naming the server's
 * default explicitly, since every card stamps it into its link — then load.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { IconCalendar, IconFilm } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { BottomNav } from "../../components/layout/BottomNav";
import { Footer } from "../../components/layout/Footer";
import { TopNav } from "../../components/layout/TopNav";
import { useStatusToast } from "../../components/ui/Toast";
import { usePageScope } from "../../hooks/usePageScope";
import { api, ensureSessionQuietly, fetchPublic, getAccessToken, loginHref, parseShowKey, showKey } from "../../lib/auth";
import { appPageHref } from "../../lib/base";
import { pageHref } from "../../lib/pages";
import { getPreferences, loadPreferences, type Preferences } from "../../lib/preferences";
import { getName, groupFamilies, type ProviderFamilyView } from "../../lib/provider-names";
import { getSelectedProvider, setSelectedProvider } from "../../lib/provider-selection";
import { isSeries, showMeta } from "../../lib/show-meta";
import type { HomeCategory, ListItem, ProvidersResponse } from "../../lib/types";
import "./home.css";

/** Hero items may carry a couple of fields no model declares; read if present. */
type HeroItem = ListItem & { year?: string | number; description?: string };

function isFeatured(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n.includes("evidenza") ||
    n.includes("featured") ||
    n.includes("highlight") ||
    n.includes("spotlight") ||
    n.includes("trending")
  );
}

function detailsPath(id: string, provider: string): string {
  return `/details?id=${encodeURIComponent(id)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`;
}

// ── Cards ──

function FeatThumb({ banner, poster }: { banner: string; poster: string }): JSX.Element {
  const [src, setSrc] = useState(banner || poster);
  if (!src) {
    return (
      <div className="feat-thumb-placeholder">
        <IconFilm />
      </div>
    );
  }
  return (
    <img
      className="feat-thumb-img"
      src={src}
      alt=""
      onError={() => setSrc(src === banner && poster && poster !== banner ? poster : "")}
    />
  );
}

function FeatCard({ item, provider }: { item: ListItem; provider: string }): JSX.Element {
  const meta = showMeta(item, 4);
  return (
    <AppLink to={detailsPath(item.id, provider)} className="feat-card">
      <div className="feat-thumb">
        <FeatThumb banner={item.banner || ""} poster={item.poster || ""} />
        {item.rating ? <div className="feat-thumb-rating">★ {item.rating}</div> : null}
        <div className="feat-thumb-kind">{isSeries(item) ? "Series" : "Movie"}</div>
        <div className="feat-thumb-overlay" />
      </div>
      <div className="feat-body">
        <div className="feat-title">{item.title || "Unknown"}</div>
        {meta && <div className="feat-meta">{meta}</div>}
      </div>
    </AppLink>
  );
}

function PortraitCard({ item, provider }: { item: ListItem; provider: string }): JSX.Element {
  const poster = item.poster || "";
  // The overlay sits over the poster and has less room than the body line.
  const meta = showMeta(item);
  const overlayMeta = showMeta(item, 2);
  return (
    <AppLink to={detailsPath(item.id, provider)} className="card">
      <div className="card-poster" style={poster ? { backgroundImage: `url(${JSON.stringify(poster)})` } : undefined}>
        {!poster && (
          <div className="card-poster-placeholder">
            <IconFilm />
          </div>
        )}
        {item.rating ? (
          <div className="card-rating">
            <span className="star">★</span>
            {item.rating}
          </div>
        ) : null}
        <div className="card-kind">{isSeries(item) ? "Series" : "Movie"}</div>
        <div className="card-overlay" />
        <div className="card-info">
          <div className="card-play">▶</div>
          <div className="card-title">{item.title || "Unknown"}</div>
          {overlayMeta && <div className="card-meta">{overlayMeta}</div>}
        </div>
      </div>
      <div className="card-body">
        <div className="card-body-title">{item.title || "Unknown"}</div>
        {meta && <div className="card-body-meta">{meta}</div>}
      </div>
    </AppLink>
  );
}

function Rail({ id, children }: { id?: string; children: ReactNode }): JSX.Element {
  const rail = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => rail.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  return (
    <div className="rail-wrap">
      <button className="rail-btn prev" onClick={() => scroll(-3)}>
        ‹
      </button>
      <div className="rail" id={id} ref={rail}>
        {children}
      </div>
      <button className="rail-btn next" onClick={() => scroll(3)}>
        ›
      </button>
    </div>
  );
}

// ── Hero ──

function HeroImage({ item }: { item: HeroItem }): JSX.Element {
  const banner = item.banner || "";
  const poster = item.poster || "";
  const [src, setSrc] = useState(banner || poster);
  const [visible, setVisible] = useState(false);
  return (
    <div className="hero-bg-img" id="heroBgImg" style={{ opacity: banner || poster ? 1 : 0 }}>
      {src && (
        <img
          src={src}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: visible ? 1 : 0,
            transition: "opacity 0.8s ease",
          }}
          onLoad={() => setVisible(true)}
          onError={() => {
            if (src === banner && poster && poster !== banner) setSrc(poster);
            else setVisible(false);
          }}
        />
      )}
    </div>
  );
}

/** Same look as the details page's watchlist button when the title is saved. */
const SAVED_STYLE: CSSProperties = {
  background: "rgba(70,211,105,0.15)",
  borderColor: "rgba(70,211,105,0.4)",
  color: "#46d369",
};

type HeroState =
  | { kind: "loading" }
  | { kind: "items"; items: HeroItem[] }
  | { kind: "message"; desc: string; action: { to: string; label: string } };

function Hero({
  hero,
  provider,
  prefs,
  watchlist,
  onWatchlist,
}: {
  hero: HeroState;
  provider: string;
  prefs: Preferences;
  watchlist: (showId: string) => { saved: boolean; pending: boolean };
  onWatchlist: (showId: string) => void;
}): JSX.Element {
  const items = hero.kind === "items" ? hero.items.slice(0, 5) : [];
  const [idx, setIdx] = useState(0);
  const [rotation, setRotation] = useState(0); // bumped to restart the timer
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => setIdx(0), [hero]);

  // Reduce motion stops the rotation too: a slide changing on its own is
  // exactly the kind of movement it asks to be spared.
  useEffect(() => {
    if (items.length === 0 || !prefs.hero_autoplay || prefs.reduce_motion) return;
    const timer = setInterval(() => setIdx((i) => (i + 1) % items.length), 7000);
    return () => clearInterval(timer);
  }, [items.length, prefs.hero_autoplay, prefs.reduce_motion, rotation, hero]);

  // Re-run the entrance transition for each slide (and for the fallback
  // messages, which just appear).
  useLayoutEffect(() => {
    const el = content.current;
    if (!el || hero.kind === "loading") return;
    el.classList.remove("loaded");
    const frame = requestAnimationFrame(() => el.classList.add("loaded"));
    return () => cancelAnimationFrame(frame);
  }, [idx, hero]);

  const item = items[idx];

  let badge = "Trending Now";
  let title = "Loading…";
  let desc = "";
  let meta: JSX.Element | null = null;
  let actions: JSX.Element = (
    <>
      <div className="skel" style={{ height: 44, width: 120, borderRadius: 5 }} />
      <div className="skel" style={{ height: 44, width: 120, borderRadius: 5 }} />
    </>
  );

  if (hero.kind === "message") {
    title = "Welcome to Streamio";
    desc = hero.desc;
    actions = (
      <AppLink to={hero.action.to} className="btn btn-primary">
        {hero.action.label}
      </AppLink>
    );
  } else if (item) {
    badge = item.genres?.[0] ? `${item.genres[0].name}` : "Trending Now";
    title = item.title || "Unknown";
    desc = item.description || item.overview || "";
    meta = (
      <>
        {item.rating ? (
          <span className="hero-meta-item">
            <span className="hero-rating">★ {item.rating}</span>
          </span>
        ) : null}
        {item.runtime ? <span className="hero-meta-item">⏱ {item.runtime} min</span> : null}
        {item.year ? (
          <span className="hero-meta-item">
            <IconCalendar /> {item.year}
          </span>
        ) : null}
      </>
    );
    const wl = watchlist(item.id);
    actions = (
      <>
        <AppLink to={detailsPath(item.id, provider)} className="btn btn-primary">
          ▶ Watch Now
        </AppLink>
        <button
          className="btn btn-secondary"
          style={wl.saved ? SAVED_STYLE : undefined}
          disabled={wl.pending}
          onClick={() => onWatchlist(item.id)}
        >
          {wl.saved ? "✓ In Watchlist" : "+ Watchlist"}
        </button>
      </>
    );
  }

  return (
    <div className="hero" id="hero">
      <div className="hero-bg" id="heroBg">
        {item ? <HeroImage key={`${item.id}-${idx}`} item={item} /> : <div className="hero-bg-img" id="heroBgImg" />}
      </div>
      <div className="hero-vignette" />
      <div className="hero-content" id="heroContent" ref={content}>
        <div className="hero-badge" id="heroBadge">
          {badge}
        </div>
        <div className="hero-title" id="heroTitle">
          {title}
        </div>
        <div className="hero-meta" id="heroMeta">
          {meta}
        </div>
        <div className="hero-desc" id="heroDesc">
          {desc}
        </div>
        <div className="hero-actions" id="heroActions">
          {actions}
        </div>
      </div>
      <div className="hero-dots" id="heroDots">
        {items.map((_, i) => (
          <button
            key={i}
            className={`hero-dot${i === idx ? " active" : ""}`}
            data-i={i}
            onClick={() => {
              setIdx(i);
              setRotation((r) => r + 1);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Source picker ──

/**
 * One trigger and a popover rather than a chip per source: there are more
 * sources than fit across the bar.
 */
function ProviderBar({
  families,
  active,
  onSelect,
}: {
  families: ProviderFamilyView[] | null;
  active: string;
  onSelect: (slug: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const select = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!select.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const family = families?.find((f) => f.languages.some((l) => l.slug === active)) ?? null;
  const lang = family?.languages.find((l) => l.slug === active);
  const triggerName = families === null ? "Loading…" : family?.displayName || active || "Select a source";

  return (
    <div className="provider-bar" id="providerBar">
      <span className="provider-label">Source</span>
      <div className="provider-select" id="providerSelect" ref={select}>
        <button
          type="button"
          className="provider-trigger"
          id="providerTrigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <span className="provider-trigger-name" id="providerTriggerName">
            {triggerName}
          </span>
          {/* Only worth showing for a source with more than one language. */}
          <span className="provider-trigger-lang" id="providerTriggerLang">
            {family && family.languages.length > 1 ? lang?.label || "" : ""}
          </span>
          <span className="provider-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <div className="provider-menu" id="providerMenu" role="listbox" hidden={!open}>
          {(families ?? []).map((f) => {
            const isActive = f.id === family?.id;
            // Selecting a source keeps the language already chosen within it.
            const target = f.languages.find((l) => l.slug === active) ?? f.languages[0];
            return (
              <button
                key={f.id}
                type="button"
                className={`provider-option${isActive ? " active" : ""}`}
                role="option"
                aria-selected={isActive}
                data-prov={target?.slug}
                onClick={() => {
                  // Picking the selected source is a no-op, not a toggle: there
                  // is no "no provider" state to go back to.
                  if (target) onSelect(target.slug);
                  setOpen(false);
                }}
              >
                <span className="provider-option-main">
                  <span className="provider-option-name">
                    {f.displayName}
                    {f.adult && (
                      <>
                        {" "}
                        <span className="chip-badge">18+</span>
                      </>
                    )}
                  </span>
                  <span className="provider-option-desc">{f.description || ""}</span>
                </span>
                {f.languages.length > 1 && (
                  <span className="provider-option-langs">{`${f.languages.length} languages`}</span>
                )}
                <span className="provider-option-check">{isActive ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Quick language switch, only for a source in more than one language. */}
      {family && family.languages.length > 1 ? (
        <div id="providerLangChips">
          {family.languages.map((l) => (
            <button
              key={l.slug}
              className={`provider-chip lang${l.slug === active ? " active" : ""}`}
              data-prov={l.slug}
              onClick={() => onSelect(l.slug)}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : (
        <div id="providerLangChips" style={{ display: "none" }} />
      )}
    </div>
  );
}

// ── Continue Watching ──

interface HistoryRow {
  provider: string;
  show_id: string;
  episode_id: string | null;
  episode_label: string | null;
  progress_seconds: number | null;
  duration_seconds: number | null;
}

interface ShowLite {
  title?: string;
  poster?: string;
  posterUrl?: string;
  rating?: number | null;
  runtime?: number | null;
}

const GATED = "gated" as const;

interface ContinueEntry {
  row: HistoryRow;
  show: ShowLite | null;
}

async function loadContinueWatching(): Promise<ContinueEntry[]> {
  // Filtered server-side, and deliberately not by provider: "keep watching"
  // is a property of the viewer, not of the source being browsed.
  const params = new URLSearchParams({ completed: "false", limit: "100", offset: "0" });
  const items = await api<HistoryRow[]>(`/api/account/history/search?${params}`);
  if (!items || !items.length) return [];

  // One card per title; rows come back newest-first, so the first one wins.
  const seen = new Set<string>();
  const inProgress = items.filter((h) => {
    const key = showKey(h.provider, h.show_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const shows = new Map<string, ShowLite | null | typeof GATED>();
  await Promise.all(
    [...seen].map(async (key) => {
      const { provider, showId } = parseShowKey(key);
      try {
        const data = await api<{ data?: ShowLite } & ShowLite>(
          `/api/shows/${encodeURIComponent(showId)}?provider=${encodeURIComponent(provider)}`,
        );
        shows.set(key, data.data ?? data);
      } catch (err) {
        // A refusal is permanent, not a failed lookup: the title is 18+ and
        // the viewer's preference is off, so it drops out of the row.
        shows.set(key, err instanceof Error && err.message === "Adult content disabled" ? GATED : null);
      }
    }),
  );

  return inProgress.flatMap((row) => {
    const show = shows.get(showKey(row.provider, row.show_id));
    if (show === GATED) return [];
    return [{ row, show: show ?? null }];
  });
}

function ContinueCard({
  entry,
  providerLabel,
}: {
  entry: ContinueEntry;
  providerLabel: (slug: string) => string;
}): JSX.Element {
  const { row: h, show } = entry;
  const pct =
    (h.progress_seconds ?? 0) > 0 && (h.duration_seconds ?? 0) > 0
      ? Math.min(100, ((h.progress_seconds as number) / (h.duration_seconds as number)) * 100)
      : 0;
  // A movie has no episode at all.
  const epLabel = h.episode_label ?? (h.episode_id ? `Ep. ${h.episode_id}` : "Resume");
  const title = show?.title ?? h.show_id;
  const poster = show?.poster ?? show?.posterUrl ?? "";
  const rating = show?.rating ?? null;
  const runtime = show?.runtime ?? null;

  function open() {
    // The row spans every source; opening a card switches to its source.
    setSelectedProvider(h.provider);
    const params = new URLSearchParams({ id: h.show_id, provider: h.provider });
    if (h.episode_id) params.set("ep", h.episode_id);
    if (h.progress_seconds) params.set("t", String(h.progress_seconds));
    window.location.href = pageHref(`/watch?${params.toString()}`);
  }

  return (
    <a
      className="card continue-card"
      data-provider={h.provider}
      data-show-id={h.show_id}
      data-episode-id={h.episode_id ?? ""}
      data-progress={h.progress_seconds ?? ""}
      onClick={open}
    >
      <div className="card-poster" style={{ backgroundImage: `url(${JSON.stringify(poster)})` }}>
        <div className="card-provider">{providerLabel(h.provider)}</div>
        {/* No rating is no chip — the vanilla page printed "N/A" here. */}
        {rating ? (
          <div className="card-rating">
            <span className="star">★</span>
            {rating.toFixed(1)}
          </div>
        ) : null}
        <div className="card-overlay" />
        <div className="card-info">
          <div className="card-play">▶</div>
          <div className="card-title">{title}</div>
          <div className="card-meta">
            {epLabel}
            {runtime ? ` · ${runtime} min` : ""}
          </div>
        </div>
        {pct > 0 ? (
          <div className="card-progress">
            <span style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="card-body">
        <div className="card-body-title">{title}</div>
        <div className="card-body-meta">{epLabel}</div>
      </div>
    </a>
  );
}

// ── Page ──

function Skeletons(): JSX.Element {
  return (
    <>
      <div className="row" id="skelRow1">
        <div className="skel" style={{ height: 22, width: 200, borderRadius: 3, marginBottom: 18 }} />
        <div className="rail">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel skel-portrait" key={i} />
          ))}
        </div>
      </div>
      <div className="row" id="skelRow2">
        <div className="skel" style={{ height: 22, width: 160, borderRadius: 3, marginBottom: 18 }} />
        <div className="rail">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skel skel-landscape" key={i} />
          ))}
        </div>
      </div>
    </>
  );
}

export default function HomePage(): JSX.Element {
  usePageScope("home", "Streamio - Home", "opsz");

  const [prefs, setPrefs] = useState<Preferences>(getPreferences);
  const [families, setFamilies] = useState<ProviderFamilyView[] | null>(null);
  const [active, setActive] = useState("");
  const [booted, setBooted] = useState(false);
  const [solid, setSolid] = useState(false);
  const { toast: toastEl, show: toast } = useStatusToast();
  const queryClient = useQueryClient();
  // Keys with a watchlist request in flight — their button stays disabled.
  const [wlPending, setWlPending] = useState<ReadonlySet<string>>(() => new Set());

  // Nav goes solid on scroll.
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 60);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureSessionQuietly();
      // Awaited before the loads: it settles which provider is active, and
      // every card they render stamps that name into its link.
      const prefsReady = loadPreferences();

      let providers = ["default"];
      let serverDefault = "";
      let catalog: ProvidersResponse["catalog"] = [];
      try {
        const res = await fetchPublic("/api/providers");
        const json = (await res.json()) as ProvidersResponse;
        if (Array.isArray(json.providers) && json.providers.length) providers = json.providers;
        if (Array.isArray(json.catalog)) catalog = json.catalog;
        serverDefault = typeof json.default === "string" ? json.default : "";
      } catch {
        // Fall back to the default.
      }

      let provider = getSelectedProvider();
      if (provider && !providers.includes(provider)) provider = "";
      // "No provider" was never a real state — name the default explicitly,
      // or every link built here would omit `provider=`.
      if (!provider && serverDefault && providers.includes(serverDefault)) provider = serverDefault;
      if (!provider && providers.length && providers[0] !== "default") provider = providers[0] ?? "";
      setSelectedProvider(provider);

      const grouped = groupFamilies(catalog?.length ? catalog : providers.map((name) => ({ name })));
      const loaded = await prefsReady;
      if (cancelled) return;
      setFamilies(grouped);
      setActive(provider);
      setPrefs(loaded);
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const home = useQuery({
    queryKey: ["home", active],
    enabled: booted,
    queryFn: async () => {
      const url = active ? `/api/home?provider=${encodeURIComponent(active)}` : "/api/home";
      const res = await fetchPublic(url);
      const json = (await res.json()) as { data?: HomeCategory[] };
      return json.data || [];
    },
  });

  const continueQuery = useQuery({
    queryKey: ["continue-watching"],
    enabled: booted && prefs.show_continue_watching && Boolean(getAccessToken()),
    queryFn: loadContinueWatching,
    retry: false,
  });

  // The signed-in visitor's watchlist as showKey()s, so the hero button can say
  // whether the slide's title is already saved.
  const watchlistKey = ["home-watchlist-keys"];
  const watchlistQuery = useQuery({
    queryKey: watchlistKey,
    enabled: booted && Boolean(getAccessToken()),
    queryFn: async () => {
      const rows = await api<{ provider: string; show_id: string }[]>("/api/account/watchlist");
      return new Set((rows || []).map((r) => showKey(r.provider, r.show_id)));
    },
    retry: false,
  });

  function watchlistState(showId: string) {
    const key = showKey(active, showId);
    return { saved: Boolean(watchlistQuery.data?.has(key)), pending: wlPending.has(key) };
  }

  function selectProvider(slug: string) {
    if (!slug || slug === active) return;
    setActive(slug);
    setSelectedProvider(slug);
    // Sync to the server, best-effort.
    fetchPublic("/api/providers/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: slug }),
    }).catch(() => {});
    // Continue Watching is deliberately not reloaded: it spans every source.
  }

  async function toggleWatchlist(showId: string) {
    if (!active) {
      toast("Select a provider first.", "error");
      return;
    }
    if (!getAccessToken()) {
      window.location.href = loginHref(appPageHref("/"));
      return;
    }
    const provider = active;
    const key = showKey(provider, showId);
    if (wlPending.has(key)) return;
    const saved = Boolean(watchlistQuery.data?.has(key));
    const setPending = (on: boolean) =>
      setWlPending((prev) => {
        const next = new Set(prev);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });
    const setSaved = (on: boolean) =>
      queryClient.setQueryData<Set<string>>(watchlistKey, (prev) => {
        const next = new Set(prev);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });
    setPending(true);
    try {
      if (saved) {
        await api(`/api/account/watchlist/${encodeURIComponent(provider)}/${encodeURIComponent(showId)}`, {
          method: "DELETE",
        });
        setSaved(false);
        toast("Removed from watchlist.");
      } else {
        await api("/api/account/watchlist", { method: "POST", body: { provider, show_id: showId } });
        setSaved(true);
        toast("Added to watchlist! ✓");
      }
    } catch (err) {
      toast(`Could not update watchlist: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setPending(false);
    }
  }

  /**
   * Short label for a provider slug on a 160px poster: the language code, not
   * its name, when a source has several.
   */
  function providerLabel(slug: string): string {
    for (const family of families ?? []) {
      const lang = family.languages.find((l) => l.slug === slug);
      if (!lang) continue;
      return family.languages.length > 1 && lang.code
        ? `${family.displayName} · ${lang.code.toUpperCase()}`
        : family.displayName;
    }
    return getName(slug);
  }

  // The hero is derived from the categories and memoized on them: Hero resets
  // its slide when this object changes, so it must not be rebuilt per render.
  const hero = useMemo<HeroState>(() => {
    const categories = home.data;
    if (!categories) return { kind: "loading" };
    if (!categories.length) {
      return {
        kind: "message",
        desc: "Select a provider above to get started.",
        action: { to: "/providers", label: "Browse Providers" },
      };
    }
    const featCat = categories.find((c) => isFeatured(c.name)) ?? categories[0];
    return featCat?.list?.length
      ? { kind: "items", items: featCat.list }
      : { kind: "message", desc: "Your unified streaming platform.", action: { to: "/catalog", label: "Browse Catalog" } };
  }, [home.data]);

  let rows: JSX.Element | JSX.Element[] = <Skeletons />;
  if (home.isError) {
    rows = <div className="empty-row">Failed to load content: {home.error.message}</div>;
  } else if (home.data) {
    const categories = home.data;
    if (!categories.length) {
      rows = <div className="empty-row">No content available for this provider.</div>;
    } else {
      const sorted = [...categories.filter((c) => isFeatured(c.name)), ...categories.filter((c) => !isFeatured(c.name))];
      rows = sorted
        .filter((c) => c.list?.length)
        .map((category, i) => {
          const wide = isFeatured(category.name);
          return (
            <div className="row" key={`${category.name}-${i}`}>
              <div className="row-header">
                <div className="row-left">
                  <div className="row-title">{category.name || "Unnamed"}</div>
                  <span className="row-count">{category.list?.length}</span>
                </div>
                <AppLink
                  to={`/catalog${active ? `?provider=${encodeURIComponent(active)}` : ""}`}
                  className="row-see-all"
                >
                  See all →
                </AppLink>
              </div>
              <Rail>
                {category.list?.map((item, j) =>
                  wide ? (
                    <FeatCard key={`${item.id}-${j}`} item={item} provider={active} />
                  ) : (
                    <PortraitCard key={`${item.id}-${j}`} item={item} provider={active} />
                  ),
                )}
              </Rail>
            </div>
          );
        });
    }
  }

  const continueEntries = continueQuery.data ?? [];

  return (
    <>
      <TopNav id="mainNav" active="home" className={solid ? "solid" : undefined} />

      <Hero
        hero={hero}
        provider={active}
        prefs={prefs}
        watchlist={watchlistState}
        onWatchlist={(id) => void toggleWatchlist(id)}
      />

      <ProviderBar families={families} active={active} onSelect={selectProvider} />

      <div className="rows" id="rowsContent">
        <div className="row" id="continueRow" style={{ display: continueEntries.length ? "block" : "none" }}>
          <div className="row-header">
            <div className="row-left">
              <div className="row-title">Continue Watching</div>
            </div>
            <AppLink to="/account#history" className="row-see-all">
              See all →
            </AppLink>
          </div>
          <Rail id="continueRail">
            {continueEntries.map((entry) => (
              <ContinueCard
                key={showKey(entry.row.provider, entry.row.show_id)}
                entry={entry}
                providerLabel={providerLabel}
              />
            ))}
          </Rail>
        </div>

        <div id="dynamicRows">{rows}</div>
      </div>

      <Footer />
      <BottomNav active="home" />
      {toastEl}
    </>
  );
}
