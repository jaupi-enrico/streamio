import type { WebPlatformHandler } from "../PlatformHandler.js";
import type { Redis } from "../database/redis.js";
import { AdultCatalogService } from "../services/adult-catalog.service.js";
import { blockedGate } from "../services/adult-filter.service.js";
import { appBaseUrl } from "../version.js";

/**
 * Open Graph tags for a details page, so a shared link gets a title, overview
 * and poster preview. The only server-rendered part of the React frontend
 * (frontend/, routes/frontend-app.ts); everything else renders in the browser.
 *
 * A crawler is anonymous, so a title is described only if an anonymous
 * visitor could see it: an 18+ source, or a title behind any gate — decided by
 * the same `blockedGate` the content routes use, with no gate open — gets no
 * tags at all. Nothing here may slow down or fail the page: any error, an
 * unknown id or a slow provider (OG_TIMEOUT_MS) yields "".
 */

const OG_TIMEOUT_MS = 1500;
const DESCRIPTION_MAX = 300;

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * An image URL a crawler can fetch. Relative paths are this server's own
 * (/api/local-media/…), so they go under APP_URL — prefix included, which is
 * why this is concatenation and not `new URL(path, base)`, which would drop it.
 */
function absoluteUrl(src: string): string | null {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return `${appBaseUrl()}${src}`;
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("og timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function createDetailsOgRenderer(platformHandler: WebPlatformHandler, redis: Redis) {
  const adultCatalog = new AdultCatalogService(redis);

  return async function detailsOgTags(query: Record<string, unknown>): Promise<string> {
    try {
      const showId = readString(query.id);
      if (!showId) return "";

      const requested = readString(query.provider);
      const provider = requested || platformHandler.getDefaultProviderName();
      const source = platformHandler.getProviderByName(provider);
      if (!source || platformHandler.isAdultProvider(provider)) return "";

      const show = (await withTimeout(platformHandler.getShowDetails(provider, showId), OG_TIMEOUT_MS)) as any;
      if (!show || typeof show.title !== "string" || !show.title) return "";

      const gated = blockedGate(show, {
        familyGates: platformHandler.adultGatesFor(provider),
        openGates: new Set(),
        denylist: await adultCatalog.getDenylist(provider, source),
      });
      if (gated || show.adult === true) return "";

      const title: string = show.title;
      const description = truncate(readString(show.overview).replace(/\s+/g, " "), DESCRIPTION_MAX);
      const image = absoluteUrl(readString(show.poster) || readString(show.banner));
      const params = new URLSearchParams({ id: showId });
      if (requested) params.set("provider", requested);
      const url = `${appBaseUrl()}/details?${params.toString()}`;

      const tags: [string, string, string][] = [
        ["property", "og:type", Array.isArray(show.seasons) ? "video.tv_show" : "video.movie"],
        ["property", "og:site_name", "Streamio"],
        ["property", "og:title", title],
        ["property", "og:url", url],
        ["name", "twitter:card", image ? "summary_large_image" : "summary"],
        ["name", "twitter:title", title],
      ];
      if (description) {
        tags.push(["property", "og:description", description]);
        tags.push(["name", "twitter:description", description]);
        tags.push(["name", "description", description]);
      }
      if (image) {
        tags.push(["property", "og:image", image]);
        tags.push(["name", "twitter:image", image]);
      }

      return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttr(value)}">`).join("\n  ");
    } catch {
      return "";
    }
  };
}
