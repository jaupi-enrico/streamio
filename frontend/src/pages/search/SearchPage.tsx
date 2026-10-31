/**
 * Search and genre browsing — a port of public/search.html +
 * scripts/search.js.
 *
 * Kept deliberately close to the original's shape: one mutable `state`
 * object that the async flows read and write, and a re-render after each
 * change (`render()` here, `renderResults()` there). A text query and a genre
 * browse are different requests, not filters layered on one — picking one
 * clears the other. Type filter and sort apply client-side over what's loaded.
 */
import { useEffect, useReducer, useRef, type JSX, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { IconAlert, IconFilm, IconInbox, IconSearch } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { BottomNav } from "../../components/layout/BottomNav";
import { TopNav } from "../../components/layout/TopNav";
import { usePageScope } from "../../hooks/usePageScope";
import { ensureSessionQuietly, fetchPublic } from "../../lib/auth";
import { getPreferences, loadPreferences, type Preferences } from "../../lib/preferences";
import { groupFamilies, type CatalogEntry, type ProviderFamilyView } from "../../lib/provider-names";
import { getSelectedProvider, setSelectedProvider } from "../../lib/provider-selection";
import { isSeries, showMeta } from "../../lib/show-meta";
import type { ListItem, ProvidersResponse } from "../../lib/types";
import "./search.css";

const RECENT_KEY = "streamio.recentSearches";

type Mode = "idle" | "search" | "genre";
type TypeFilter = "all" | "movie" | "tv";
interface Genre {
  id: string | number;
  name: string;
}

interface State {
  provider: string;
  query: string;
  genre: Genre | null;
  mode: Mode;
  page: number;
  items: ListItem[];
  type: TypeFilter;
  sort: string;
  loading: boolean;
  exhausted: boolean;
  /** Set when the last fetch failed; cleared by the next render request. */
  error: string | null;
  booted: boolean;
}

/** Four-digit year of a title, for the Year sort. */
function yearOf(item: ListItem): number {
  const raw = item.details?.releaseDate || item.released;
  const match = raw ? String(raw).match(/\b(\d{4})\b/) : null;
  return match ? Number(match[1]) : 0;
}

function StateBox({ icon, title, detail = "", spinning = false }: {
  icon: ReactNode;
  title: string;
  detail?: string;
  spinning?: boolean;
}): JSX.Element {
  return (
    <div className="state-box">
      <div className={`icon${spinning ? " spinning" : ""}`}>{icon}</div>
      <strong>{title}</strong>
      {detail}
    </div>
  );
}

function Card({ item, provider }: { item: ListItem; provider: string }): JSX.Element {
  const poster = item.poster || "";
  const title = item.title || "Unknown";
  const meta = showMeta(item);
  const overlayMeta = showMeta(item, 2);
  const to = `/details?id=${encodeURIComponent(item.id)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`;
  return (
    <AppLink to={to} className="card">
      <div className="card-poster" style={poster ? { backgroundImage: `url(${JSON.stringify(poster)})` } : undefined}>
        {!poster && <div className="card-poster-bg" />}
        {item.rating ? (
          <div className="card-rating">
            <span className="star">★</span>
            {Number(item.rating).toFixed(1)}
          </div>
        ) : null}
        <div className="card-kind">{isSeries(item) ? "Series" : "Movie"}</div>
        <div className="card-overlay" />
        <div className="card-info">
          <div className="card-play">▶</div>
          <div className="card-title">{title}</div>
          {overlayMeta && <div className="card-meta">{overlayMeta}</div>}
        </div>
      </div>
      <div className="card-body">
        <div className="card-body-title">{title}</div>
        {meta && <div className="card-body-meta">{meta}</div>}
      </div>
    </AppLink>
  );
}

export default function SearchPage(): JSX.Element {
  usePageScope("search", "Streamio - Search");
  const navigate = useNavigate();
  const [, render] = useReducer((n: number) => n + 1, 0);

  const s = useRef<State>({
    provider: getSelectedProvider(),
    query: "",
    genre: null,
    mode: "idle",
    page: 1,
    items: [],
    type: "all",
    sort: "relevance",
    loading: false,
    exhausted: false,
    error: null,
    booted: false,
  }).current;
  const prefs = useRef<Preferences>(getPreferences());
  const genres = useRef<Genre[]>([]);
  const families = useRef<ProviderFamilyView[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Bumped per request so a slow, superseded response can't overwrite a newer one. */
  const requestId = useRef(0);

  // ── URL / storage ──

  function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
    const search = new URLSearchParams();
    if (s.provider) search.set("provider", s.provider);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }
    const qs = search.toString();
    return qs ? `${path}?${qs}` : path;
  }

  /** Keeps the address bar shareable without a history entry per keystroke. */
  function syncUrl() {
    const params = new URLSearchParams();
    if (s.query) params.set("q", s.query);
    if (s.genre) params.set("genre", String(s.genre.id));
    if (s.provider) params.set("provider", s.provider);
    const qs = params.toString();
    navigate(qs ? `/search?${qs}` : "/search", { replace: true });
  }

  function readRecent(): string[] {
    if (!prefs.current.search_history) return [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === "string") : [];
    } catch {
      return [];
    }
  }

  function rememberSearch(query: string) {
    if (!prefs.current.search_history) return;
    const recent = [query, ...readRecent().filter((q) => q !== query)].slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      // A full or blocked storage costs the history, not the search.
    }
  }

  // ── Data ──

  async function loadProviders() {
    try {
      const res = await fetchPublic("/api/providers");
      const json = (await res.json()) as ProvidersResponse;
      const entries: CatalogEntry[] =
        Array.isArray(json.catalog) && json.catalog.length
          ? json.catalog
          : (Array.isArray(json.providers) ? json.providers : []).map((name) => ({ name }));

      // A saved provider the server no longer lists (e.g. an 18+ one after the
      // preference was turned off) must not stay selected.
      if (s.provider && !entries.some((e) => e.name === s.provider)) {
        s.provider = "";
        setSelectedProvider("");
      }
      families.current = groupFamilies(entries);
    } catch {
      families.current = [];
    }
    render();
  }

  async function loadGenres() {
    genres.current = [];
    try {
      const res = await fetchPublic(buildUrl("/api/genres"));
      const json = (await res.json()) as { data?: Genre[] };
      if (res.ok && Array.isArray(json.data)) {
        genres.current = json.data.filter((g) => g && g.id != null && g.name);
      }
    } catch {
      // A provider whose genre catalogue can't be reached just shows none.
    }
    render();
  }

  async function fetchPage(page: number): Promise<ListItem[]> {
    if (s.mode === "search") {
      const res = await fetchPublic(buildUrl("/api/search", { query: s.query, page }));
      const json = (await res.json()) as { data?: ListItem[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Search failed");
      return Array.isArray(json.data) ? json.data : [];
    }

    const res = await fetchPublic(buildUrl(`/api/genres/${encodeURIComponent(String(s.genre?.id))}`, { page }));
    const json = (await res.json()) as { data?: { name?: string; shows?: ListItem[] }; error?: string };
    if (!res.ok) throw new Error(json.error || "Could not load genre");

    // The genre's own name is only known server-side, so adopt it once loaded.
    if (json.data?.name && s.genre) s.genre = { ...s.genre, name: json.data.name };
    return Array.isArray(json.data?.shows) ? json.data.shows : [];
  }

  async function load({ append = false } = {}) {
    if (s.mode === "idle") return;
    // A fresh search supersedes one in flight; only "Load more" must wait.
    if (append && s.loading) return;

    const mine = ++requestId.current;
    s.loading = true;
    s.error = null;
    if (!append) {
      s.page = 1;
      s.items = [];
      s.exhausted = false;
    }
    render();

    try {
      const items = await fetchPage(s.page);
      if (mine !== requestId.current) return;
      // Providers page by fixed-size batches and return fewer (or an echo of
      // the last page) at the end, so an empty page is the only reliable
      // end-of-results signal.
      if (!items.length) {
        s.exhausted = true;
      } else {
        const seen = new Set(s.items.map((i) => i.id));
        const fresh = items.filter((i) => i?.id && !seen.has(i.id));
        if (!fresh.length) s.exhausted = true;
        s.items = s.items.concat(fresh);
      }
    } catch (err) {
      if (mine !== requestId.current) return;
      s.loading = false;
      s.exhausted = true;
      s.error = err instanceof Error ? err.message : String(err);
      render();
      return;
    }

    s.loading = false;
    render();
  }

  // ── Actions ──

  function selectProvider(provider: string) {
    if (s.provider === provider) return;
    s.provider = provider;
    setSelectedProvider(provider);

    // Genres and results are both provider-scoped: a genre id from one site
    // means nothing on another, so the browse resets rather than carries over.
    s.genre = null;
    s.error = null;
    if (s.mode === "genre") {
      s.mode = "idle";
      s.items = [];
    }

    syncUrl();
    void loadProviders();
    void loadGenres();

    if (s.mode === "search") void load();
    else render();
  }

  function selectGenre(genre: Genre | null) {
    s.genre = genre || null;
    s.mode = genre ? "genre" : s.query ? "search" : "idle";
    s.error = null;

    if (genre) {
      // A genre browse replaces the text search rather than filtering it.
      s.query = "";
      if (inputRef.current) inputRef.current.value = "";
    }

    syncUrl();
    if (s.mode === "idle") {
      s.items = [];
      render();
    } else {
      void load();
    }
  }

  function runSearch(raw?: string) {
    const query = (raw ?? inputRef.current?.value ?? "").trim();
    s.error = null;

    if (!query) {
      s.query = "";
      s.mode = s.genre ? "genre" : "idle";
      s.items = [];
      syncUrl();
      render();
      return;
    }

    s.query = query;
    s.mode = "search";
    s.genre = null;

    rememberSearch(query);
    syncUrl();
    void load();
  }

  // ── Boot ──

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Results are filtered per user (18+), so the session is restored before
      // the first query — and before the provider list, which hides adult
      // providers from anyone without the preference.
      await ensureSessionQuietly();
      prefs.current = await loadPreferences();
      if (cancelled) return;
      if (!prefs.current.search_history) {
        // "Turning it off also clears it" — what was stored stays gone.
        try {
          localStorage.removeItem(RECENT_KEY);
        } catch {
          // Storage blocked.
        }
      }
      s.sort = prefs.current.search_sort;

      const params = new URLSearchParams(location.search);
      const initialProvider = params.get("provider");
      if (initialProvider) {
        s.provider = initialProvider;
        setSelectedProvider(initialProvider);
      }

      await loadProviders();
      await loadGenres();
      if (cancelled) return;
      s.booted = true;

      const initialQuery = params.get("q");
      const initialGenre = params.get("genre");
      const initialGenreName = params.get("genreName");

      if (initialQuery) {
        if (inputRef.current) inputRef.current.value = initialQuery;
        runSearch(initialQuery);
      } else if (initialGenre) {
        const known = genres.current.find((g) => String(g.id) === initialGenre);
        // A deep link can name a genre the catalogue hasn't got — browse it
        // anyway and let the server supply the name.
        selectGenre(known || { id: initialGenre, name: "" });
      } else if (initialGenreName) {
        // The detail page links by name when the provider parsed the genre
        // off the title without an id; a name with no match is worth more as
        // a text search than as an empty browse.
        const wanted = initialGenreName.trim().toLowerCase();
        const known = genres.current.find((g) => g.name.trim().toLowerCase() === wanted);
        if (known) {
          selectGenre(known);
        } else {
          if (inputRef.current) inputRef.current.value = initialGenreName;
          runSearch(initialGenreName);
        }
      } else {
        render();
        inputRef.current?.focus();
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(debounce.current);
    };
    // Boot runs once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onInput() {
    clearTimeout(debounce.current);
    const value = (inputRef.current?.value ?? "").trim();
    // One character matches nearly everything upstream; below two, wait for
    // Enter or the button.
    if (value.length < 2) return;
    debounce.current = setTimeout(() => runSearch(), 450);
  }

  // ── Render ──

  function visibleItems(): ListItem[] {
    let items = s.items;
    if (s.type === "movie") items = items.filter((i) => !isSeries(i));
    if (s.type === "tv") items = items.filter(isSeries);
    if (s.sort === "title") {
      items = [...items].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else if (s.sort === "rating") {
      items = [...items].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    } else if (s.sort === "year") {
      items = [...items].sort((a, b) => yearOf(b) - yearOf(a));
    }
    return items;
  }

  let results: JSX.Element | null = null;
  let filterBar = false;
  let loadMore = false;
  let heading = "";
  let count = "";
  const shown = visibleItems();

  if (s.error) {
    results = <StateBox icon={<IconAlert />} title="Error" detail={s.error} />;
  } else if (s.mode === "idle") {
    // Before boot the vanilla page is simply empty.
    results = s.booted ? (
      <StateBox
        icon={<IconFilm />}
        title="Start browsing"
        detail={genres.current.length ? "Search for a title, or pick a genre above" : "Type a title above and press Search"}
      />
    ) : null;
  } else if (s.loading && !s.items.length) {
    results = <StateBox icon="⏳" title="Loading…" spinning />;
  } else if (!s.items.length) {
    results = (
      <StateBox
        icon={<IconSearch />}
        title="No results"
        detail={s.mode === "genre" ? `Nothing in ${s.genre?.name || "this genre"}` : `Nothing matched "${s.query}"`}
      />
    );
  } else {
    filterBar = true;
    loadMore = !s.exhausted;
    heading = s.mode === "genre" ? s.genre?.name || "Genre" : `Results for "${s.query}"`;
    count = `${shown.length} title${shown.length !== 1 ? "s" : ""}${
      shown.length !== s.items.length ? ` of ${s.items.length}` : ""
    }`;
    results = shown.length ? (
      <div className="results-grid">
        {shown.map((item) => (
          <Card key={item.id} item={item} provider={s.provider} />
        ))}
      </div>
    ) : (
      <StateBox icon={<IconInbox />} title="Nothing to show" detail="No loaded titles match this filter" />
    );
  }

  const activeFamily = families.current.find((f) => f.languages.some((l) => l.slug === s.provider));
  const recent = s.booted ? readRecent() : [];

  return (
    <>
      <TopNav active="search" />

      <div className="page-wrap">
        <div className="search-hero">
          <h1>Search</h1>
          <p>Find any movie or show by title, or browse by genre</p>
          <div className="search-box">
            <div className="search-icon">
              <IconSearch />
            </div>
            <input
              ref={inputRef}
              type="search"
              className="search-input"
              id="searchInput"
              placeholder="Search titles…"
              autoComplete="off"
              onInput={onInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  clearTimeout(debounce.current);
                  runSearch();
                }
              }}
            />
            <button
              className="search-btn"
              id="searchBtn"
              onClick={() => {
                clearTimeout(debounce.current);
                runSearch();
              }}
            >
              Search
            </button>
          </div>
        </div>

        <div className="facets">
          <section className="facet">
            <h2 className="facet-label">Provider</h2>
            <div className="chip-row" id="providerChips">
              {families.current.map((family) => {
                const active = family.languages.some((l) => l.slug === s.provider);
                // Keep the language already chosen within this source rather
                // than resetting to its default when coming back to it.
                const target = family.languages.find((l) => l.slug === s.provider) ?? family.languages[0];
                return (
                  <button
                    key={family.id}
                    className={`chip${active ? " active" : ""}`}
                    data-provider={target?.slug}
                    onClick={() => target && selectProvider(target.slug)}
                  >
                    {family.displayName}
                    {family.adult && (
                      <>
                        {" "}
                        <span className="chip-badge">18+</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Only for a source available in more than one language. */}
            {activeFamily && activeFamily.languages.length > 1 ? (
              <div className="chip-row lang-row" id="providerLangChips">
                {activeFamily.languages.map((l) => (
                  <button
                    key={l.slug}
                    className={`chip lang${l.slug === s.provider ? " active" : ""}`}
                    data-provider={l.slug}
                    onClick={() => selectProvider(l.slug)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="chip-row lang-row" id="providerLangChips" style={{ display: "none" }} />
            )}
          </section>

          <section className="facet" id="genreSection" style={genres.current.length ? undefined : { display: "none" }}>
            <h2 className="facet-label">Genre</h2>
            <div className="chip-row" id="genreChips">
              {genres.current.map((g) => (
                <button
                  key={String(g.id)}
                  className={`chip genre-chip${s.genre?.id === g.id ? " active" : ""}`}
                  data-genre={String(g.id)}
                  // Clicking the active genre clears it — the only way back to
                  // the landing state without emptying the search box too.
                  onClick={() => selectGenre(s.genre?.id === g.id ? null : g)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </section>

          <section className="facet" id="recentSection" style={recent.length ? undefined : { display: "none" }}>
            <h2 className="facet-label">Recent searches</h2>
            <div className="chip-row" id="recentChips">
              {recent.map((q) => (
                <button
                  key={q}
                  className="chip"
                  data-query={q}
                  onClick={() => {
                    if (inputRef.current) inputRef.current.value = q;
                    runSearch(q);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="filter-bar" id="filterBar" style={filterBar ? undefined : { display: "none" }}>
          <div className="filter-heading">
            <span className="results-title" id="resultsTitle">
              {heading}
            </span>
            <span className="results-count" id="resultsCount">
              {count}
            </span>
          </div>
          <div className="filter-controls">
            <div className="segmented" role="group" aria-label="Filter by type">
              {(
                [
                  ["all", "All"],
                  ["movie", "Movies"],
                  ["tv", "Series"],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  data-type={type}
                  className={s.type === type ? "active" : undefined}
                  onClick={() => {
                    s.type = type;
                    render();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sort-field">
              <span>Sort</span>
              <select
                id="sortSelect"
                value={s.sort}
                onChange={(e) => {
                  s.sort = e.target.value;
                  render();
                }}
              >
                <option value="relevance">Relevance</option>
                <option value="title">Title A–Z</option>
                <option value="rating">Rating</option>
                <option value="year">Year</option>
              </select>
            </label>
          </div>
        </div>

        <div className="results-area" id="resultsArea">
          {results}
        </div>

        <div className="load-more-wrap" id="loadMoreWrap" style={loadMore && !s.error ? undefined : { display: "none" }}>
          <button
            className="load-more-btn"
            id="loadMoreBtn"
            disabled={s.loading}
            onClick={() => {
              s.page += 1;
              void load({ append: true });
            }}
          >
            {s.loading ? "Loading…" : "Load more"}
          </button>
        </div>
      </div>

      <BottomNav active="search" />
    </>
  );
}
