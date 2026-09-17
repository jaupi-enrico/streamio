// adult-filter.service.ts
//
// Removes 18+ items from a content response.
//
// These are deliberately plain functions over plain data, applied in
// content.router.ts *after* the platform handler returns — i.e. after the Redis
// cache. The cache stays global and unfiltered (keyed by provider only, see
// PlatformHandler), so there is no per-user cache bleed and no cache-key change.
//
// Which means everything here operates on JSON, not on `Movie`/`TvShow`
// instances: a cache hit deserializes to bare objects, so `adult`/`adultGate`
// have to be read as properties and never as anything requiring the class.
//
// An item is not merely "18+ or not" — it sits behind a named gate, and the
// question is whether *that* gate is open for this user. See
// `core/models/AdultGate.ts`.
import {
  ADULT_MASTER_GATE,
  isGateOpen,
} from "../core/models/AdultGate.js";

/** Everything one request needs to decide what to hide. Built once per request. */
export type AdultContext = {
  /** The gates the requested source declares; `[0]` is its default. */
  familyGates: readonly string[];
  /** Ids this source is known to serve as 18+ but doesn't flag per item. */
  denylist: ReadonlySet<string>;
  /** The gates this user has opened. */
  openGates: ReadonlySet<string>;
};

/**
 * Which gate an item sits behind, or null when it isn't 18+ at all.
 *
 * An item may name its own gate, which is how a source serving more than one
 * kind of 18+ content tells them apart. A flagged item that names none takes
 * its family's first gate; one whose family declares no gates answers to the
 * master key alone, which is the safe end of that guess rather than the
 * permissive one.
 */
export function gateForItem(
  item: any,
  familyGates: readonly string[],
  denylist: ReadonlySet<string>
): string | null {
  if (!item) return null;

  const flagged =
    item.adult === true ||
    (typeof item.id === "string" && denylist.has(item.id));
  if (!flagged) return null;

  if (typeof item.adultGate === "string" && item.adultGate) {
    return item.adultGate;
  }
  return familyGates[0] ?? ADULT_MASTER_GATE;
}

/**
 * The gate blocking this item, or null when it is visible — either because it
 * isn't 18+ or because the gate it sits behind is open.
 *
 * Returns the gate rather than a boolean so a route can tell the caller *which*
 * preference would unlock it, instead of naming one global key that may not be
 * the one that applies.
 */
export function blockedGate(item: any, ctx: AdultContext): string | null {
  const gate = gateForItem(item, ctx.familyGates, ctx.denylist);
  if (!gate) return null;
  return isGateOpen(ctx.openGates, gate) ? null : gate;
}

export function isAdultItem(item: any, ctx: AdultContext): boolean {
  return blockedGate(item, ctx) !== null;
}

export function filterItems<T>(items: T[], ctx: AdultContext): T[] {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => blockedGate(item, ctx) === null);
}

/**
 * Filters each rail's items and drops rails left empty — a home page with a
 * titled but empty row reads as broken.
 */
export function filterCategories<T extends { list?: any[] }>(
  categories: T[],
  ctx: AdultContext
): T[] {
  if (!Array.isArray(categories)) return categories;

  return categories
    .map((category) => ({
      ...category,
      list: filterItems(category.list ?? [], ctx),
    }))
    .filter((category) => category.list.length > 0);
}
