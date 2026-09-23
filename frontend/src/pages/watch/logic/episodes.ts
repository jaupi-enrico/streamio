/**
 * The episode list: its shape, and which slice of it the grid shows.
 * Ports of toEpisodeCard / episodeTitle / episodeBadges / episodeStateClass /
 * applyEpisodeButtonProgressBar / visibleEpisodes / renderSeasonTabs in
 * public/scripts/watch.js.
 *
 * The list itself is always the whole show — autoplay-next, room sync and the
 * cast payload all index into it. Only the rendering is sliced, which is why
 * an episode is found by id and never by its position in the grid.
 */

/** An episode as `GET /api/seasons/:id/episodes` serializes it. */
export interface ApiEpisode {
  id?: string;
  number?: number | null;
  title?: string | null;
  poster?: string | null;
  overview?: string | null;
  runtime?: number | null;
  quality?: string | null;
  dubIta?: boolean | null;
  subIta?: boolean | null;
  released?: string | null;
}

export interface ApiSeason {
  id: string;
  number?: number | null;
  title?: string | null;
  episodes?: ApiEpisode[];
}

/** API episode → the shape the grid, autoplay and the cast payload all read. */
export interface EpisodeCard {
  id: string;
  seasonId: string;
  title: string;
  seasonNum: number | string;
  episodeNum: number | string;
  poster: string | null;
  overview: string | null;
  runtime: number | null;
  quality: string | null;
  dubIta: boolean | null;
  subIta: boolean | null;
  released: string | null;
}

export function toEpisodeCard(ep: ApiEpisode, season: ApiSeason): EpisodeCard {
  return {
    id: ep.id || `s${season.number}-e${ep.number}`,
    seasonId: season.id,
    title: ep.title || "Episode",
    seasonNum: season.number || "?",
    episodeNum: ep.number || "?",
    poster: ep.poster || null,
    overview: ep.overview || null,
    runtime: ep.runtime || null,
    quality: ep.quality || null,
    dubIta: ep.dubIta ?? null,
    subIta: ep.subIta ?? null,
    released: ep.released || null,
  };
}

/** "S1E2" — what the grid, the OSD, history and the room all call an episode. */
export function episodeLabel(ep: Pick<EpisodeCard, "seasonNum" | "episodeNum">): string {
  return `S${ep.seasonNum}E${ep.episodeNum}`;
}

/**
 * A title worth printing next to the number, or "" when the source only has
 * the number itself or a generic "Episode".
 *
 * The pattern is the vanilla page's byte for byte — including its doubled
 * escapes, which make it demand a literal backslash, so "Episodio 5" is *not*
 * collapsed on either page. Kept identical while both pages are live.
 */
export function episodeTitle(ep: Pick<EpisodeCard, "title" | "episodeNum">): string {
  const title = (ep.title || "").trim();
  if (!title) return "";
  if (title === "Episode") return "";
  if (String(ep.episodeNum) === title) return "";
  if (new RegExp(`^(episodio|episode|ep\\\\.?)\\\\s*${ep.episodeNum}$`, "i").test(title)) return "";
  return title;
}

/** Per-episode facts, which can differ from the show's (a late dub, one SD episode). */
export function episodeBadges(ep: Pick<EpisodeCard, "runtime" | "quality" | "dubIta" | "subIta">): string[] {
  return [ep.runtime ? `${ep.runtime} min` : "", ep.quality || "", ep.dubIta ? "ITA" : "", ep.subIta ? "SUB ITA" : ""].filter(
    Boolean,
  );
}

/** One row of `GET /api/account/history/progress/:provider/:showId`. */
export interface ProgressEntry {
  episode_id: string;
  completed: boolean;
  progress_seconds: number;
  duration_seconds: number | null;
}

export type ProgressMap = ReadonlyMap<string, ProgressEntry>;

/**
 * "completed", "in-progress" (past the same >10s mark resume uses) or "".
 */
export function episodeStateClass(map: ProgressMap, episodeId: string): "" | "completed" | "in-progress" {
  const entry = map.get(episodeId);
  if (!entry) return "";
  if (entry.completed) return "completed";
  if (entry.progress_seconds > 10) return "in-progress";
  return "";
}

/** The `.epbtn-progress` width, or "" for none — finished episodes show no bar. */
export function episodeProgressWidth(map: ProgressMap, episodeId: string): string {
  const entry = map.get(episodeId);
  if (entry && !entry.completed && entry.duration_seconds && entry.duration_seconds > 0) {
    const pct = Math.min(100, Math.round((entry.progress_seconds / entry.duration_seconds) * 100));
    return `${pct}%`;
  }
  return "";
}

// A show with more episodes than this is unusable as one flat list of rich
// cards, so it opens compact. The user's choice wins from then on.
export const COMPACT_THRESHOLD = 60;

export interface EpisodeView {
  /** Season id currently shown, or "all". */
  seasonId: string;
  /** Free-text filter: an episode number, or words from the title. */
  query: string;
  /** Dense number grid instead of full cards. */
  compact: boolean;
}

/** The layout a freshly loaded list opens in, per the `episode_layout` preference. */
export function initialCompact(layout: string, count: number): boolean {
  return layout === "auto" ? count > COMPACT_THRESHOLD : layout === "compact";
}

/** The episodes the current season/filter selection puts on screen. */
export function visibleEpisodes(list: readonly EpisodeCard[], view: EpisodeView): EpisodeCard[] {
  const query = view.query.trim().toLowerCase();
  return list.filter((ep) => {
    if (view.seasonId !== "all" && ep.seasonId !== view.seasonId) return false;
    if (!query) return true;
    // A bare number matches the episode number exactly, so typing "7" in a
    // 1000-episode show doesn't return every episode containing a 7.
    if (/^\d+$/.test(query)) {
      return String(ep.episodeNum) === query || `s${ep.seasonNum}e${ep.episodeNum}`.includes(query);
    }
    return (
      (ep.title || "").toLowerCase().includes(query) || `s${ep.seasonNum}e${ep.episodeNum}`.toLowerCase().includes(query)
    );
  });
}

export interface SeasonTab {
  id: string;
  label: string;
  count: number;
}

/** Season/block tabs plus "Tutti" — none at all for a single season. */
export function seasonTabs(seasons: readonly ApiSeason[], list: readonly EpisodeCard[]): SeasonTab[] {
  if (seasons.length < 2) return [];
  const counts = new Map<string, number>();
  for (const ep of list) counts.set(ep.seasonId, (counts.get(ep.seasonId) || 0) + 1);
  return [
    { id: "all", label: "Tutti", count: list.length },
    ...seasons
      .filter((s) => counts.get(s.id))
      .map((s) => ({
        id: s.id,
        // Range-tab sources already label these "1-120"; real seasons
        // usually have no name at all.
        label: s.title || (s.number ? `Stagione ${s.number}` : "Episodi"),
        count: counts.get(s.id) || 0,
      })),
  ];
}

/**
 * The view that puts `ep` on screen: unchanged when it already is, otherwise
 * the filter cleared and — unless "Tutti" is open — its own season selected.
 */
export function viewRevealing(list: readonly EpisodeCard[], view: EpisodeView, ep: EpisodeCard): EpisodeView {
  if (visibleEpisodes(list, view).some((e) => e.id === ep.id)) return view;
  const next = { ...view, query: "" };
  if (next.seasonId !== "all" && ep.seasonId !== next.seasonId) next.seasonId = ep.seasonId;
  return next;
}
