/**
 * What a title's metadata *is* — a port of public/scripts/show-meta.js. The
 * pages only own the markup (<MetaLine>, <FactList>).
 *
 *  - **Never invent a placeholder.** An item with nothing to say gets [] /
 *    "", and the caller drops the element rather than printing a dash.
 *  - Absence in `details` means "this source doesn't publish it", never a
 *    default, so every read is guarded.
 *  - Cards are narrow. At most three parts, most identifying first.
 *
 * `frontend/src/lib/parity.test.ts` checks the output against the vanilla
 * module while both frontends are live.
 */
import type { ShowDetails } from "./types";

/**
 * The fields read here, structurally: listing items, full Movie/TvShow and
 * library rows all satisfy it, whatever else they carry.
 */
export interface MetaItem {
  seasons?: unknown;
  released?: string | null;
  runtime?: number | null;
  quality?: string | null;
  genres?: { name?: string | null }[] | null;
  details?: ShowDetails | null;
}

/** Only a TvShow serializes a `seasons` array; Movie has no such field. */
export function isSeries(item: MetaItem | null | undefined): boolean {
  return Array.isArray(item?.seasons);
}

/** Four-digit year out of an ISO date, a Date string, or a bare year. */
function year(value: unknown): string | null {
  if (!value) return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? (match[1] ?? null) : null;
}

/**
 * The format label, as the source published it; only when none did, the
 * structural guess.
 */
function kindLabel(item: MetaItem): string {
  const published = item?.details?.contentType;
  if (published) return published;
  return isSeries(item) ? "Serie" : "Film";
}

/** Parts in priority order, deduped and capped. */
export function showMetaParts(item: MetaItem | null | undefined, limit = 3): string[] {
  if (!item) return [];
  const d: ShowDetails = item.details || {};
  const parts: unknown[] = [];

  parts.push(kindLabel(item));

  const released = year(d.releaseDate) || year(item.released);
  if (released) parts.push(released);

  // Episode counters only mean something for a series, and the most recent
  // episode is the more useful of the two on a "latest episodes" rail.
  if (d.latestEpisode) {
    parts.push(`Ep ${d.latestEpisode}`);
  } else if (d.episodeCount) {
    parts.push(`${d.episodeCount} ep`);
  } else if (d.seasonCount) {
    parts.push(d.seasonCount === 1 ? "1 stagione" : `${d.seasonCount} stagioni`);
  }

  if (item.runtime) parts.push(`${item.runtime} min`);
  if (item.quality) parts.push(item.quality);
  if (d.status) parts.push(d.status);
  if (d.studio) parts.push(d.studio);
  if (item.genres?.[0]?.name) parts.push(item.genres[0].name);

  return [...new Set(parts.filter(Boolean).map(String))].slice(0, limit);
}

/** Ready-to-print meta line, or "" when the item carries nothing. */
export function showMeta(item: MetaItem | null | undefined, limit = 3): string {
  return showMetaParts(item, limit).join(" · ");
}

// ── Facts (watch + details) ─────────────────────────────────
// The two pages render the same facts in different markup — a chip strip on
// the watch page, a table on the details page.

const AUDIO_LABELS = {
  dubIta: "Doppiaggio ITA",
  subIta: "Sottotitoli ITA",
  original: "Audio originale",
} as const;

export const STAT_LABELS = {
  views: "Visualizzazioni",
  dailyViews: "Visite oggi",
  favorites: "Preferiti",
  members: "Follower",
  votes: "Voti",
} as const;

export function formatNumber(n: unknown): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("it-IT") : null;
}

/**
 * Only a full ISO day is reformatted; a bare year or already-formatted text
 * is printed as published rather than guessed at.
 */
export function formatDate(value: unknown): string | null {
  if (!value) return null;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return String(value);
  const d = new Date(`${iso[0]}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Maturity rating as a label: a number is an age, a string a certificate. */
export function ageLabel(ageRating: unknown): string | null {
  if (ageRating == null || ageRating === "") return null;
  return typeof ageRating === "number" ? `${ageRating}+` : String(ageRating);
}

/** The audio/subtitle tracks a source claims, as one line. */
export function audioLabel(details: ShowDetails = {}): string | null {
  const audio = details.audio as Record<string, unknown> | undefined;
  const tracks: string[] = Object.entries(AUDIO_LABELS)
    .filter(([key]) => audio?.[key])
    .map(([, label]) => label);
  if (audio?.language) tracks.push(String(audio.language));
  return tracks.join(" · ") || null;
}

export interface Fact {
  label: string;
  value: string;
}

/**
 * Ordered facts, skipping everything the source didn't publish. Plain
 * strings only — anything needing markup stays with the page.
 */
export function showFacts(item: MetaItem | null | undefined): Fact[] {
  if (!item) return [];
  const d: ShowDetails = item.details || {};

  const released = formatDate(d.releaseDate) || formatDate(String(item.released || "").slice(0, 10));

  const facts: [string, unknown][] = [
    ["Titolo orig.", d.originalTitle],
    ["Tipo", d.contentType],
    ["Stato", d.status],
    ["Uscita", released],
    ["Ultimo ep.", formatDate(d.lastAirDate)],
    ["Stagione", d.seasonLabel],
    ["In onda", d.airDay],
    ["Episodi", formatNumber(d.episodeCount)],
    ["Ultimo episodio", d.latestEpisode ? `Ep ${d.latestEpisode}` : null],
    ["Stagioni", formatNumber(d.seasonCount)],
    ["Durata", item.runtime ? `${item.runtime} min` : null],
    // Per-episode runtime only earns a row when it isn't already `runtime`.
    ["Durata ep.", d.episodeRuntime && d.episodeRuntime !== item.runtime ? `${d.episodeRuntime} min` : null],
    ["Studio", d.studio],
    ["Lingua orig.", d.originalLanguage],
    ["Audio", audioLabel(d)],
    ["Età", ageLabel(d.ageRating)],
    ["Qualità", item.quality],
  ];

  return facts
    .filter(([, value]) => value != null && value !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
}
