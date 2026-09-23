/**
 * The three paginated library tabs — watchlist, favorites and history.
 *
 * A port of the paging machine in public/scripts/account.js. It lives outside
 * React for the same reason it lives outside the DOM there: a page in flight,
 * its generation, the offset the *server* read and the shared show cache are
 * all sequenced state that a re-render must not restart. React subscribes to a
 * snapshot through `useSyncExternalStore` and renders it.
 *
 * Every non-obvious rule below is the vanilla page's, kept deliberately:
 *  - paging steps by the rows the query read (`X-Page-Rows`), never by the
 *    array length, because 18+ filtering happens after the LIMIT;
 *  - a caller that arrives mid-page joins that page instead of giving up;
 *  - a reset always goes through and discards the in-flight page by
 *    generation, so a stale response can't land on top of the new listing;
 *  - a failed *later* page leaves the rows already on screen alone.
 */
import { apiFetch } from "../../lib/auth";
import { fetchShow } from "../../lib/api";
import { parseShowKey, showKey } from "../../lib/auth";
import type { LibraryItem, LibraryShow } from "./types";

export const PAGE_SIZE = 24; // one full row of the grid at every breakpoint
export const SCROLL_MARGIN_PX = 400; // start the next page this far before the end

const SHOW_FETCH_CONCURRENCY = 4;
const SHOW_FETCH_RETRIES = 2;
const SHOW_FETCH_RETRY_DELAY_MS = 500;

/**
 * Marks a row the server refused as 18+. Distinct from a missing entry (a
 * failed lookup), which is transient and worth retrying — this one never will
 * be, and the row has to disappear rather than render as a bare show_id.
 */
export const GATED = Symbol("gated");
type CacheEntry = LibraryShow | typeof GATED;

const showCache = new Map<string, CacheEntry>();

/** The cached title for a row, or null when it isn't (or can't be) known. */
export function cachedShow(item: { provider: string; show_id: string }): LibraryShow | null {
  const entry = showCache.get(showKey(item.provider, item.show_id));
  return entry && entry !== GATED ? entry : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function lookupShow(provider: string, showId: string): Promise<CacheEntry | null> {
  for (let attempt = 0; attempt <= SHOW_FETCH_RETRIES; attempt++) {
    const result = await fetchShow<LibraryShow>(provider, showId);
    if (result.kind === "ok") return result.show;
    if (result.kind === "gated") return GATED;
    if (attempt < SHOW_FETCH_RETRIES) await sleep(SHOW_FETCH_RETRY_DELAY_MS * (attempt + 1));
  }
  return null;
}

async function runWithConcurrency(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const task = queue.shift();
      if (!task) return;
      await task();
    }
  });
  await Promise.all(workers);
}

/**
 * Fetches details for any row not yet in the cache. Failed lookups are left
 * unset (not poisoned), so a later call — re-opening the tab — retries them.
 */
export async function hydrateShowCache(items: { provider: string; show_id: string }[]): Promise<void> {
  const uniqueKeys = [...new Set(items.map((i) => showKey(i.provider, i.show_id)))].filter(
    (key) => !showCache.has(key),
  );

  await runWithConcurrency(
    uniqueKeys.map((key) => async () => {
      const { provider, showId } = parseShowKey(key);
      const show = await lookupShow(provider, showId);
      if (show) showCache.set(key, show);
    }),
    SHOW_FETCH_CONCURRENCY,
  );
}

/** Drops entries the server refused as 18+ — see GATED. */
function withoutGated<T extends { provider: string; show_id: string }>(items: T[]): T[] {
  return items.filter((i) => showCache.get(showKey(i.provider, i.show_id)) !== GATED);
}

export interface LibrarySnapshot {
  data: LibraryItem[];
  total: number | null;
  exhausted: boolean;
  loading: boolean;
  failed: boolean;
  settled: boolean;
  filtered: boolean;
  version: number;
}

interface PageResult {
  items: LibraryItem[];
  total: number | null;
  rows: number;
}

/**
 * Like `api()`, but also returns the listing's full size: the library
 * endpoints answer with a bare JSON array and carry the totals in headers, so
 * `apiFetch` is used directly — `api()` discards the response along with them.
 */
async function fetchPage(url: string): Promise<PageResult> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const items = (await res.json()) as LibraryItem[];
  // An absent header must stay null, not fall through to Number(null) === 0
  // and report an empty library.
  const num = (name: string): number | null => {
    const raw = res.headers.get(name);
    const n = raw === null || raw === "" ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return { items, total: num("X-Total-Count"), rows: num("X-Page-Rows") ?? items.length };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export class LibraryList {
  readonly endpoint: string;
  readonly searchEndpoint: string;

  data: LibraryItem[] = [];
  filters: Record<string, string> = {};
  /** A row test the server can't run, applied once the row is hydrated. */
  clientFilter: ((item: LibraryItem) => boolean) | null = null;
  total: number | null = null;
  exhausted = false;
  /** True until the first page of the current listing has landed. The tabs
   *  render their spinner from it, as the vanilla page's static markup did. */
  loading = true;
  failed = false;
  /** True once any page has landed or failed — before that the counters read
   *  "Loading…" rather than zero. */
  settled = false;

  private offset = 0;
  /** False until the first page was asked for. `loading` starts true so the
   *  spinner renders first, which makes it useless for telling "never
   *  started" from "in flight" — the vanilla page's flag starts false. */
  private started = false;
  private filling = false;
  private inflight: Promise<void> | null = null;
  private generation = 0;
  private version = 0;
  private snapshot: LibrarySnapshot;
  private listeners = new Set<() => void>();
  private sentinel: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.searchEndpoint = `${endpoint}/search`;
    this.snapshot = this.buildSnapshot();
  }

  private buildSnapshot(): LibrarySnapshot {
    return {
      data: this.data,
      total: this.total,
      exhausted: this.exhausted,
      loading: this.loading,
      failed: this.failed,
      settled: this.settled,
      filtered: this.clientFilter !== null,
      version: this.version,
    };
  }

  private emit(): void {
    this.version++;
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LibrarySnapshot => this.snapshot;

  /** Attaches the element whose visibility drives paging. */
  setSentinel(el: HTMLElement | null): void {
    this.sentinel = el;
    this.observer?.disconnect();
    this.observer = null;
    if (!el || typeof IntersectionObserver === "undefined") return; // Load More still works
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void this.fillViewport();
      },
      { rootMargin: `${SCROLL_MARGIN_PX}px` },
    );
    this.observer.observe(el);
  }

  /** True while the sentinel is on screen (or nearly), and its tab is visible. */
  private sentinelInView(): boolean {
    const el = this.sentinel;
    if (!el || !el.offsetParent) return false;
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight + SCROLL_MARGIN_PX && rect.bottom > -SCROLL_MARGIN_PX;
  }

  /**
   * Keeps pulling pages while the sentinel stays in view.
   *
   * An IntersectionObserver only fires on a *transition*, so a page that lands
   * shorter than the viewport — the first one, or one whose rows were mostly
   * dropped as 18+ — would otherwise leave the sentinel parked on screen with
   * nothing left to retrigger it.
   */
  async fillViewport(): Promise<void> {
    if (this.filling) return;
    this.filling = true;
    try {
      while (!this.exhausted && this.sentinelInView()) {
        const before = this.offset;
        await this.loadPage();
        if (this.offset === before) break; // a failed or empty page — don't spin
      }
    } finally {
      this.filling = false;
    }
  }

  /**
   * Fetches one page and appends it. `reset` starts the listing over.
   *
   * A caller arriving while a page is in flight **joins** it rather than
   * giving up: bailing stalled the scroll, because the sentinel then sat on
   * screen with no further intersection left to fire.
   */
  loadPage(opts: { reset?: boolean } = {}): Promise<void> {
    if (this.loading && !opts.reset) return this.inflight ?? Promise.resolve();
    const p = this.fetchAndAppend(opts);
    this.inflight = p;
    return p;
  }

  /** One page, then top up until the viewport is full. */
  async load(reset: boolean): Promise<void> {
    await this.loadPage({ reset });
    await this.fillViewport();
  }

  private async fetchAndAppend({ reset = false }: { reset?: boolean } = {}): Promise<void> {
    if (reset) {
      this.started = true;
      this.generation++;
      this.offset = 0;
      this.data = [];
      this.total = null;
      this.exhausted = false;
      this.failed = false;
    }
    if (this.exhausted) return;

    const gen = this.generation;
    const stale = (): boolean => gen !== this.generation;
    this.loading = true;
    this.emit();
    try {
      const qs = buildQuery({ ...this.filters, limit: PAGE_SIZE, offset: this.offset });
      const endpoint = Object.keys(this.filters).length ? this.searchEndpoint : this.endpoint;
      const { items, total, rows } = await fetchPage(`${endpoint}${qs}`);
      if (stale()) return;

      // Both of these follow the rows the server *read*, never the array
      // length: 18+ filtering happens after the LIMIT, so a page of 24 can
      // arrive as 21. Stepping by 21 would re-request — and duplicate — the
      // three that were dropped, and read a full page as the last one.
      this.offset += rows;
      this.exhausted = rows < PAGE_SIZE;
      if (total !== null) this.total = total;

      await hydrateShowCache(items);
      if (stale()) return;

      const kept = withoutGated(items).filter((i) => !this.clientFilter || this.clientFilter(i));
      this.data = [...this.data, ...kept];
    } catch {
      // A failed *first* page has nothing to show but the error; a failed
      // later one must not wipe out the rows already on screen.
      if (!stale() && !this.data.length) this.failed = true;
    } finally {
      // A superseded page leaves the flag to the newer call that owns it.
      if (!stale()) {
        this.loading = false;
        this.settled = true;
        this.emit();
      }
    }
  }

  /**
   * Re-attempts show lookups that failed on a previous load, and re-renders
   * only if any of them now succeeded.
   */
  async retryMissingShows(): Promise<void> {
    const missing = (): number => this.data.filter((i) => !showCache.has(showKey(i.provider, i.show_id))).length;
    const before = missing();
    if (before === 0) return;
    await hydrateShowCache(this.data);
    if (missing() < before) this.emit();
  }

  /** Opening a tab: load the first page, or top up what's already there. */
  activate(): void {
    if (!this.started || (this.data.length === 0 && !this.loading)) {
      void this.load(true);
      return;
    }
    void this.retryMissingShows();
    void this.fillViewport();
  }

  /** Replaces the rows (a removal, a completion) without refetching. */
  setData(data: LibraryItem[], total = this.total): void {
    this.data = data;
    this.total = total;
    this.emit();
  }

  /** Everything gone, nothing more to fetch — the "clear history" case. */
  clear(): void {
    this.started = true;
    this.generation++;
    this.data = [];
    this.offset = 0;
    this.total = 0;
    this.exhausted = true;
    this.loading = false;
    this.settled = true;
    this.failed = false;
    this.emit();
  }

  /** Applies a new filter set and starts the listing over. */
  applyFilters(filters: Record<string, string>, clientFilter: ((item: LibraryItem) => boolean) | null = null): void {
    this.filters = filters;
    this.clientFilter = clientFilter;
    void this.load(true);
  }
}

/** The provider slugs seen in any library row, for the filter dropdowns. */
const knownProviders = new Set<string>();

export function rememberProviders(items: { provider: string }[]): string[] {
  for (const i of items) knownProviders.add(i.provider);
  return [...knownProviders].sort();
}
