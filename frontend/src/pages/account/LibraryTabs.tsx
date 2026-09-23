/**
 * Watchlist, favorites and history — the three paginated library tabs.
 *
 * The listing state (paging, the show cache, the in-flight page) lives in
 * library-store.ts; this file is the markup and the filter bars, which is the
 * only part that differs between the three.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { IconBookmark, IconClock, IconFilm, IconAlert } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { api } from "../../lib/auth";
import { relativeDate } from "./format";
import { cachedShow, LibraryList, rememberProviders } from "./library-store";
import { goToShow } from "./navigate-to-show";
import type { LibraryItem } from "./types";

type Toast = (msg: string, type?: "success" | "error") => void;

/** A poster that falls back to the film glyph the moment it fails to load. */
function Poster({ item, cover = false }: { item: LibraryItem; cover?: boolean }): JSX.Element {
  const show = cachedShow(item);
  const poster = show?.poster ?? show?.posterUrl ?? null;
  const [broken, setBroken] = useState(false);
  if (!poster || broken)
    return (
      <span>
        <IconFilm />
      </span>
    );
  return (
    <img
      src={poster}
      alt=""
      style={cover ? { width: "100%", height: "100%", objectFit: "cover" } : undefined}
      onError={() => setBroken(true)}
    />
  );
}

function titleOf(item: LibraryItem): string {
  return cachedShow(item)?.title ?? item.show_id;
}

function Empty({ icon, title, body, cta }: { icon: ReactNode; title: string; body: string; cta?: boolean }): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {cta && (
        <AppLink to="/catalog" className="btn btn-primary">
          Browse Catalog
        </AppLink>
      )}
    </div>
  );
}

function LoadFailed({ label }: { label: string }): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">
        <IconAlert />
      </div>
      <h3>Couldn&apos;t Load</h3>
      <p>Failed to load {label}.</p>
    </div>
  );
}

/** The spinner block each tab shows before its first page lands. */
function Loading({ label }: { label?: string }): JSX.Element {
  return (
    <div className="empty">
      <div className="spinner" style={{ margin: "0 auto 16px" }} />
      {label && <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>{label}</div>}
    </div>
  );
}

/** Subscribes a component to one list's snapshot. */
function useList(list: LibraryList) {
  return useSyncExternalStore(list.subscribe, list.getSnapshot);
}

/** The provider options every filter bar shares — every slug seen so far. */
function useProviderOptions(list: LibraryList, version: number): string[] {
  const [options, setOptions] = useState<string[]>([]);
  useEffect(() => {
    setOptions(rememberProviders(list.data));
  }, [list, version]);
  return options;
}

function Sentinel({ list, id }: { list: LibraryList; id: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    list.setSentinel(ref.current);
    return () => list.setSentinel(null);
  }, [list]);
  return <div className="scroll-sentinel" id={id} ref={ref} />;
}

function LoadMore({
  list,
  exhausted,
  onClick,
  ids,
}: {
  list: LibraryList;
  exhausted: boolean;
  onClick: () => void;
  ids: { wrap: string; button: string; sentinel: string };
}): JSX.Element {
  return (
    <>
      <div className="load-more" id={ids.wrap} style={{ display: exhausted ? "none" : "block" }}>
        <button className="btn btn-secondary" id={ids.button} onClick={onClick}>
          Load More
        </button>
      </div>
      <Sentinel list={list} id={ids.sentinel} />
    </>
  );
}

// ── Watchlist and favorites ──

interface GridProps {
  list: LibraryList;
  kind: "wl" | "fv";
  toast: Toast;
}

const GRID_COPY = {
  wl: { title: "My Watchlist", endpoint: "/api/account/watchlist", removed: "Removed from watchlist.", label: "watchlist" },
  fv: { title: "My Favorites", endpoint: "/api/account/favorites", removed: "Removed from favorites.", label: "favorites" },
} as const;

/**
 * A text filter's native `change` semantics, which is what the vanilla page
 * listened for: commit on Enter or blur, and only when the value moved since
 * the last commit or focus. Committing on every blur restarted the listing —
 * and dropped every page already scrolled in — just for tabbing past the box.
 */
function useCommitOnChange(value: string, commit: () => void) {
  const baseline = useRef(value);
  const fire = (): void => {
    if (value === baseline.current) return;
    baseline.current = value;
    commit();
  };
  return {
    onFocus: () => {
      baseline.current = value;
    },
    onBlur: fire,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter") fire();
    },
  };
}

export function LibraryGrid({ list, kind, toast }: GridProps): JSX.Element {
  const snap = useList(list);
  const navigate = useNavigate();
  const copy = GRID_COPY[kind];
  const providerOptions = useProviderOptions(list, snap.version);

  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [minRating, setMinRating] = useState("");
  const searchCommit = useCommitOnChange(search, () => apply(search, provider, minRating));

  const apply = useCallback(
    (s: string, p: string, r: string) => {
      if (kind === "fv") {
        list.applyFilters(clean({ search: s.trim(), provider: p, min_rating: r }));
        return;
      }
      // The title's own score, as its provider reports it on the details every
      // card is hydrated from — not the score you gave it (favorites filter on
      // that). Nothing stores it server-side, so it's tested here; a title with
      // no score doesn't match any threshold.
      list.applyFilters(
        clean({ search: s.trim(), provider: p }),
        r === ""
          ? null
          : (item) => {
              const rating = cachedShow(item)?.rating;
              return typeof rating === "number" && rating >= Number(r);
            },
      );
    },
    [kind, list],
  );

  function clear(): void {
    setSearch("");
    setProvider("");
    setMinRating("");
    list.applyFilters({}, null);
  }

  async function remove(item: LibraryItem): Promise<void> {
    try {
      await api(`${copy.endpoint}/${encodeURIComponent(item.provider)}/${encodeURIComponent(item.show_id)}`, {
        method: "DELETE",
      });
      list.setData(
        list.data.filter((i) => !(i.provider === item.provider && i.show_id === item.show_id)),
        list.total !== null ? Math.max(0, list.total - 1) : null,
      );
      toast(copy.removed);
      // The grid just got shorter — the sentinel may have risen into view.
      void list.fillViewport();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const prefix = kind;
  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">{copy.title}</div>
          <div className="section-sub" id={`${prefix}Subtitle`}>{subtitleFor(snap)}</div>
        </div>
        <AppLink to="/catalog" className="btn btn-secondary btn-sm">
          + Add Shows
        </AppLink>
      </div>
      <div className="filter-bar" id={`${prefix}FilterBar`}>
        <input
          className={`field-input ${prefix}Filter`}
          id={`${prefix}Search`}
          type="text"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          {...searchCommit}
        />
        <select
          className={`field-input ${prefix}Filter`}
          id={`${prefix}ProviderFilter`}
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            apply(search, e.target.value, minRating);
          }}
        >
          <option value="">All providers</option>
          {providerOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={`field-input ${prefix}Filter`}
          id={`${prefix}RatingFilter`}
          value={minRating}
          onChange={(e) => {
            setMinRating(e.target.value);
            apply(search, provider, e.target.value);
          }}
        >
          <option value="">Any rating</option>
          <option value="9">9+</option>
          <option value="8">8+</option>
          <option value="7">7+</option>
          <option value="6">6+</option>
        </select>
        <button className="btn btn-secondary btn-sm" id={`${prefix}FilterBtn`} onClick={() => apply(search, provider, minRating)}>
          Apply
        </button>
        <button className="btn btn-ghost btn-sm" id={`${prefix}FilterClearBtn`} onClick={clear}>
          Clear
        </button>
      </div>

      <div id={kind === "wl" ? "watchlistContent" : "favoritesContent"}>
        {snap.failed && !snap.data.length ? (
          <LoadFailed label={copy.label} />
        ) : !snap.data.length && snap.filtered ? (
          snap.exhausted ? (
            <Empty icon={<IconBookmark />} title="No Matches" body="Nothing in your watchlist is rated that high." />
          ) : (
            <Loading />
          )
        ) : !snap.data.length ? (
          snap.loading ? (
            <Loading label={`Loading ${copy.label}…`} />
          ) : (
            <Empty icon={<IconBookmark />} title="Nothing Saved Yet" body="Add shows from the catalog to see them here." cta />
          )
        ) : (
          <div className={kind === "wl" ? "watchlist-grid" : "favorites-grid"}>
            {snap.data.map((item) => (
              <div
                key={`${item.provider}:${item.show_id}`}
                className={`${prefix}-card`}
                onClick={() => goToShow(navigate, item.provider, item.show_id)}
              >
                <div className={`${prefix}-poster`}>
                  <Poster item={item} cover />
                  <div className={`${prefix}-overlay`}>▶</div>
                  <span className={`${prefix}-provider-chip`}>{item.provider}</span>
                  <div
                    className={`${prefix}-remove`}
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(item);
                    }}
                  >
                    ✕
                  </div>
                </div>
                <div className={`${prefix}-info`}>
                  <div className={`${prefix}-title`}>{titleOf(item)}</div>
                  <div className={`${prefix}-meta`}>Added {relativeDate(item.added_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <LoadMore
        list={list}
        exhausted={snap.exhausted}
        onClick={() => void list.load(false)}
        ids={{ wrap: `${prefix}LoadMoreWrap`, button: `${prefix}LoadMoreBtn`, sentinel: `${prefix}Sentinel` }}
      />
    </>
  );
}

/**
 * The subtitle under a tab's title.
 *
 * The count is the server's total, not the rows loaded so far, so it reads
 * correctly from the first page. A client-side filter's total can't be known
 * by the server, so while one is on it counts what matched — marked
 * open-ended until the last page is in.
 */
function subtitleFor(snap: {
  data: LibraryItem[];
  total: number | null;
  exhausted: boolean;
  filtered: boolean;
  settled: boolean;
}): string {
  if (!snap.settled) return "Loading…";
  const n = snap.filtered ? snap.data.length : (snap.total ?? snap.data.length);
  const more = snap.filtered && !snap.exhausted ? "+" : "";
  return snap.filtered
    ? `${n}${more} matching show${n !== 1 ? "s" : ""}`
    : `${n} saved show${n !== 1 ? "s" : ""}`;
}

/** The count on a tab button, by the same rule as the subtitle. */
export function listCount(snap: { data: LibraryItem[]; total: number | null; exhausted: boolean; filtered: boolean }): string {
  const n = snap.filtered ? snap.data.length : (snap.total ?? snap.data.length);
  return `${n}${snap.filtered && !snap.exhausted ? "+" : ""}`;
}

export function useListSnapshot(list: LibraryList) {
  return useList(list);
}

function clean(filters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "" && v !== undefined));
}

// ── History ──

export function HistoryTab({ list, toast }: { list: LibraryList; toast: Toast }): JSX.Element {
  const snap = useList(list);
  const navigate = useNavigate();
  const providerOptions = useProviderOptions(list, snap.version);

  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const searchCommit = useCommitOnChange(search, () => apply());

  function apply(next: Partial<Record<string, string>> = {}): void {
    const f = { search: search.trim(), provider, completed: status, date_from: from, date_to: to, ...next };
    list.applyFilters(clean(f as Record<string, string>));
  }

  function clearFilters(): void {
    setSearch("");
    setProvider("");
    setStatus("");
    setFrom("");
    setTo("");
    list.applyFilters({});
  }

  async function clearHistory(): Promise<void> {
    if (!confirm("Clear your entire watch history?")) return;
    try {
      await api("/api/account/history", { method: "DELETE" });
      list.clear();
      toast("History cleared.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  const sameRow = (a: LibraryItem, provider: string, showId: string, episode: string): boolean =>
    a.provider === provider && a.show_id === showId && (a.episode_id || "") === episode;

  async function remove(item: LibraryItem): Promise<void> {
    const episode = item.episode_id || "";
    try {
      await api(
        `/api/account/history/${encodeURIComponent(item.provider)}/${encodeURIComponent(item.show_id)}${
          episode ? `/${encodeURIComponent(episode)}` : ""
        }`,
        { method: "DELETE" },
      );
      list.setData(
        list.data.filter((h) => !sameRow(h, item.provider, item.show_id, episode)),
        list.total !== null ? Math.max(0, list.total - 1) : null,
      );
      toast("Removed from history.");
      void list.fillViewport();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function complete(item: LibraryItem): Promise<void> {
    const episode = item.episode_id || "";
    try {
      await api("/api/account/history/complete", {
        method: "PUT",
        body: { provider: item.provider, show_id: item.show_id, episode_id: episode || null },
      });
      list.setData(
        list.data.map((h) =>
          sameRow(h, item.provider, item.show_id, episode)
            ? { ...h, completed: true, progress_seconds: h.duration_seconds ?? h.progress_seconds }
            : h,
        ),
      );
      toast("Marked as complete.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Watch History</div>
          <div className="section-sub">Recently watched shows and episodes</div>
        </div>
        <button className="btn btn-ghost btn-sm" id="clearHistoryBtn" onClick={() => void clearHistory()}>
          Clear All
        </button>
      </div>
      <div className="filter-bar" id="histFilterBar">
        <input
          className="field-input histFilter"
          id="histSearch"
          type="text"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          {...searchCommit}
        />
        <select
          className="field-input histFilter"
          id="histProviderFilter"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            apply({ provider: e.target.value });
          }}
        >
          <option value="">All providers</option>
          {providerOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="field-input histFilter"
          id="histStatusFilter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            apply({ completed: e.target.value });
          }}
        >
          <option value="">Any status</option>
          <option value="true">Completed</option>
          <option value="false">In progress</option>
        </select>
        <input
          className="field-input histFilter"
          id="histDateFrom"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            apply({ date_from: e.target.value });
          }}
        />
        <input
          className="field-input histFilter"
          id="histDateTo"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            apply({ date_to: e.target.value });
          }}
        />
        <button className="btn btn-secondary btn-sm" id="histFilterBtn" onClick={() => apply()}>
          Apply
        </button>
        <button className="btn btn-ghost btn-sm" id="histFilterClearBtn" onClick={clearFilters}>
          Clear
        </button>
      </div>

      <div id="historyContent">
        {snap.failed && !snap.data.length ? (
          <LoadFailed label="history" />
        ) : !snap.data.length ? (
          snap.loading ? (
            <Loading label="Loading history…" />
          ) : (
            <Empty icon={<IconClock />} title="No History Yet" body="Start watching to see your progress here." cta />
          )
        ) : (
          <div className="history-list">
            {snap.data.map((item) => {
              const pct =
                (item.progress_seconds ?? 0) > 0 && (item.duration_seconds ?? 0) > 0
                  ? Math.min(100, ((item.progress_seconds as number) / (item.duration_seconds as number)) * 100)
                  : 0;
              const epLabel = item.episode_label ?? (item.episode_id ? `Ep. ${item.episode_id}` : null);
              return (
                <div
                  key={`${item.provider}:${item.show_id}:${item.episode_id || ""}`}
                  className="history-item"
                  onClick={() => goToShow(navigate, item.provider, item.show_id)}
                >
                  <div className="history-thumb">
                    <Poster item={item} />
                  </div>
                  <div className="history-body">
                    <div className="history-title">{titleOf(item)}</div>
                    <div className="history-ep">
                      {epLabel ? `${epLabel} · ` : ""}
                      {item.provider}
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="history-meta">
                    <div className="history-date">{relativeDate(item.watched_at)}</div>
                    <span className={`history-badge ${item.completed ? "done" : "prog"}`}>
                      {item.completed ? "✓ Done" : "In progress"}
                    </span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm btn-icon history-complete"
                    title="Mark as complete"
                    style={{ flexShrink: 0, marginLeft: 8 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void complete(item);
                    }}
                  >
                    ✓
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-icon history-remove"
                    title="Remove"
                    style={{ flexShrink: 0, marginLeft: 8 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(item);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <LoadMore
        list={list}
        exhausted={snap.exhausted}
        onClick={() => void list.load(false)}
        ids={{ wrap: "loadMoreWrap", button: "loadMoreBtn", sentinel: "histSentinel" }}
      />
    </>
  );
}
