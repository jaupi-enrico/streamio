// core/models/AdultGate.ts
//
// The vocabulary of the 18+ gate, and nothing else.
//
// A *gate* is a kind of adult content, named by the provider family that serves
// it (`adultGates` in ProviderRegistry.ts) and opened by the user with a
// `user_preferences` row called `adult-<gate>` set to JSON `true`. `adult-all`
// is the master: it opens every gate, including one no provider has declared
// yet.
//
// Gate *names* live in the provider files and nowhere else. This module only
// knows how a key is spelled and how a set of open gates answers a question,
// so adding a source with a new kind of 18+ content stays a one-file change
// and no central list can fall out of step with the registry.
//
// It lives under `core/models/` rather than `services/` because both sides need
// it — `core/core.ts` decides which sources are listable, `services/` decide
// which items are visible — and `core` must never import a service.

/** Every 18+ preference key starts with this. Chosen to contain no SQL `LIKE`
 *  wildcard, so `key LIKE 'adult-%'` means exactly what it reads as. */
export const ADULT_KEY_PREFIX = "adult-";

/** The gate that opens all the others. */
export const ADULT_MASTER_GATE = "all";

/** The preference key a user sets to open every gate at once. */
export const ADULT_MASTER_KEY = `${ADULT_KEY_PREFIX}${ADULT_MASTER_GATE}`;

/** The `user_preferences` key that opens one gate. */
export function adultKeyFor(gate: string): string {
  return `${ADULT_KEY_PREFIX}${gate}`;
}

/**
 * Whether a preference key is one of ours — used to bust the resolved-gate
 * cache on write. Deliberately a prefix test and not an equality check against
 * a list: the set of gates is whatever the registered providers declare, and a
 * list here would have to be edited every time one is added.
 */
export function isAdultPreferenceKey(key: string): boolean {
  return key.startsWith(ADULT_KEY_PREFIX);
}

/** The gate name behind an `adult-` key. */
export function gateFromKey(key: string): string {
  return key.slice(ADULT_KEY_PREFIX.length);
}

/**
 * Whether one item's gate is open. A null gate means the item isn't 18+ at
 * all, which is always visible.
 */
export function isGateOpen(
  open: ReadonlySet<string>,
  gate: string | null,
): boolean {
  if (!gate) return true;
  return open.has(ADULT_MASTER_GATE) || open.has(gate);
}

/**
 * Whether *every* gate a source declares is open — i.e. nothing it returns can
 * be hidden, so filtering can be skipped entirely rather than walked item by
 * item.
 *
 * A source that declares no gates is not automatically clear: it can still
 * return an item flagged 18+ (or one the denylist knows), and such an item
 * answers to the master key alone. So only the master opens that case.
 */
export function allGatesOpen(
  familyGates: readonly string[] | undefined,
  open: ReadonlySet<string>,
): boolean {
  if (open.has(ADULT_MASTER_GATE)) return true;

  const gates = familyGates ?? [];
  return gates.length > 0 && gates.every((gate) => open.has(gate));
}

/**
 * Whether *any* gate a source declares is open — whether a whole-provider 18+
 * source is listable at all. A source with two gates appears in the picker as
 * soon as one of them is open; its titles behind the other stay filtered.
 */
export function anyGateOpen(
  familyGates: readonly string[] | undefined,
  open: ReadonlySet<string>,
): boolean {
  if (open.has(ADULT_MASTER_GATE)) return true;
  return (familyGates ?? []).some((gate) => open.has(gate));
}
