// adult.service.ts
//
// Resolves which 18+ gates a user has opened.
//
// A gate is a kind of adult content named by the provider that serves it (see
// `core/models/AdultGate.ts` for the vocabulary and `adultGates` in
// `ProviderRegistry.ts` for where a source declares its own). The user opens
// one with a `user_preferences` row called `adult-<gate>` set to JSON `true`,
// and `adult-all` opens every one of them.
//
// This service never names a gate. It reads whatever `adult-` rows exist and
// hands back the set, so a source introducing a new kind of 18+ content is a
// one-file change in `core/providers/` with nothing to update here.
//
// The pre-gate global key `adult_content` is retired and deliberately does not
// match the `adult-` prefix: an account that still carries it gets no access
// from it, rather than silently keeping a master switch nobody can see.
//
// Anonymous callers get no gates at all. The content routes are unauthenticated
// by design (optionalAuth, not requireAuth), so "no user" is the common case and
// has to be the safe one.
import type { Database } from "../database/db.js";
import type { Redis } from "../database/redis.js";
import { ADULT_KEY_PREFIX, gateFromKey } from "../core/models/AdultGate.js";

const CACHE_PREFIX = "adultgates:";
// Short: every content request asks, and the set is busted explicitly on write,
// so this only bounds the staleness of a change made on another server.
const CACHE_TTL_SECONDS = 60;

function cacheKey(userId: string) {
  return `${CACHE_PREFIX}${userId}`;
}

export class AdultService {
  constructor(
    private db: Database,
    private redis: Redis
  ) {}

  /**
   * The gate names this user has opened, or `{"all"}` for the master.
   *
   * Only a real JSON `true` opens a gate. A stray string "true" or a 1 left
   * behind by the custom-preference modal does not — preferences are free-form
   * JSON, so this is a shape we can actually receive.
   *
   * One query and one cache entry per user regardless of how many gates exist,
   * because both callers (the content gate and the provider list) need the
   * whole set, not a single answer.
   */
  async openGates(userId?: string | null): Promise<Set<string>> {
    if (!userId) return new Set();

    const cached = await this.redis
      .get<string[]>(cacheKey(userId))
      .catch(() => null);
    if (Array.isArray(cached)) return new Set(cached);

    // `adult-` carries no SQL wildcard (`%` or `_`), so this prefix match means
    // exactly what it reads as.
    const rows = await this.db
      .query<{ key: string; value: unknown }>(
        `SELECT key, value FROM user_preferences WHERE user_id = $1 AND key LIKE $2`,
        [userId, `${ADULT_KEY_PREFIX}%`]
      )
      .catch(() => null);

    const gates = new Set<string>();
    for (const row of rows?.rows ?? []) {
      if (row.value === true) {
        const gate = gateFromKey(row.key);
        if (gate) gates.add(gate);
      }
    }

    await this.redis
      .set(cacheKey(userId), [...gates], CACHE_TTL_SECONDS)
      .catch(() => {});

    return gates;
  }

  /**
   * Called when any `adult-` preference is written or deleted, so the change
   * takes effect on the next request instead of up to a minute later.
   */
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(cacheKey(userId)).catch(() => {});
  }
}
