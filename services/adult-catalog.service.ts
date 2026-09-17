// adult-catalog.service.ts
//
// The 18+ denylist backstop the providers were written against but which was
// never wired up:
// `content.router.ts`'s `gate()` used to hand every route a hardcoded empty
// `Set`, so a title whose listing/detail payload carries no per-item `adult`
// signal (home rails and search cards on several sources expose no genre at
// all) had no way to be gated short of a full detail fetch per card.
//
// A provider that can enumerate its own adult catalogue implements
// `AdultCatalogProvider.listAdultIds()` (`core/models/Provider.ts`). That
// crawl can be dozens of upstream requests, so the result is cached in Redis
// well past the 60s the user-preference cache uses — freshness here only
// matters for a title entering or leaving the source's own adult listing, not
// per-request — and concurrent callers during a cold cache collapse onto one
// crawl instead of each starting their own.
import type { Redis } from "../database/redis.js";
import { supportsAdultCatalog, type Provider } from "../core/models/Provider.js";

const CACHE_PREFIX = "adultcatalog:";
const CACHE_TTL_SECONDS = 6 * 60 * 60;
// A crawl that came back empty (or failed) is cached only briefly, so a
// transient upstream hiccup doesn't leave a provider's whole catalogue
// ungated for hours.
const EMPTY_CACHE_TTL_SECONDS = 5 * 60;

export class AdultCatalogService {
  // Per-provider, per-process: collapses concurrent requests during a cold
  // cache onto a single crawl rather than one per request.
  private inFlight = new Map<string, Promise<Set<string>>>();

  constructor(private redis: Redis) {}

  /**
   * The denylist for one provider. Empty for a provider that doesn't
   * implement `listAdultIds` — that leaves the gate exactly where it was,
   * same as every other structural-capability check in this codebase.
   */
  async getDenylist(providerName: string, provider: Provider | undefined): Promise<Set<string>> {
    if (!provider || !supportsAdultCatalog(provider)) return new Set();

    const key = `${CACHE_PREFIX}${providerName}`;

    const cached = await this.redis.get<string[]>(key).catch(() => null);
    if (Array.isArray(cached)) return new Set(cached);

    let pending = this.inFlight.get(providerName);
    if (!pending) {
      pending = provider
        .listAdultIds()
        .then((ids) => new Set(ids))
        .catch((e) => {
          console.error(`adult-catalog: listAdultIds failed for "${providerName}":`, e);
          return new Set<string>();
        })
        .finally(() => this.inFlight.delete(providerName));
      this.inFlight.set(providerName, pending);
    }

    const denylist = await pending;
    await this.redis
      .set(key, [...denylist], denylist.size ? CACHE_TTL_SECONDS : EMPTY_CACHE_TTL_SECONDS)
      .catch(() => {});

    return denylist;
  }
}
