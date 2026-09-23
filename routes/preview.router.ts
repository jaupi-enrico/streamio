import path from "node:path";
import express, { Router } from "express";
import { publicLimiter } from "../auth/rateLimit.js";
import type { Redis } from "../database/redis.js";
import type { WebPlatformHandler } from "../PlatformHandler.js";
import { FRONTEND_DIR, frontendBuilt, renderAppIndex } from "./frontend-app.js";
import { createDetailsOgRenderer } from "./og-meta.js";

/**
 * `/preview/*` — the React frontend (frontend/), served next to the vanilla
 * one so each page can be compared side by side before anything switches
 * over. The live site (public/, public.router.ts) is untouched by this.
 *
 * Same origin as the live pages, so the refresh cookie and every localStorage
 * key are shared: a session started on either works on both.
 *
 * Absent (404) until `npm run build` has produced dist/frontend.
 */
export function createPreviewRouter(redis: Redis, platformHandler: WebPlatformHandler) {
  const router = Router();
  const detailsOgTags = createDetailsOgRenderer(platformHandler, redis);
  // Per route, not router.use — see the note in public.router.ts. Only the
  // HTML document counts against it; assets are static files.
  const limit = publicLimiter(redis);

  const assets = express.static(FRONTEND_DIR, {
    index: false,
    // Its trailing-slash redirect for `/preview` would answer with a
    // root-relative Location that drops a path-prefixed install's prefix;
    // the page handler below serves `/preview` itself instead.
    redirect: false,
    setHeaders: (res, filePath) => {
      // Vite content-hashes everything under assets/, so a file there never
      // changes; icons and other public/ copies keep a short TTL.
      const hashed = filePath.startsWith(path.join(FRONTEND_DIR, "assets") + path.sep);
      res.setHeader("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    },
  });

  router.use((req, res, next) => {
    if (!frontendBuilt()) {
      res.status(404).type("text/plain").send("The preview frontend has not been built (npm run build).");
      return;
    }
    // The raw template would come back without its config; the page itself
    // is only ever served through the handler below.
    if (req.path === "/index.html") {
      next();
      return;
    }
    assets(req, res, next);
  });

  router.get("/{*splat}", limit, async (req, res) => {
    // A path with an extension that express.static didn't find is a missing
    // asset: answering it with the page would hand a script tag HTML.
    if (path.extname(req.path)) {
      res.status(404).end();
      return;
    }
    // Link previews for shared details pages; "" for anything else.
    const headExtra = req.path === "/details" ? await detailsOgTags(req.query as Record<string, unknown>) : "";
    const html = renderAppIndex({
      mount: "/preview",
      requestPath: req.originalUrl.split("?")[0] ?? "/",
      headExtra,
    });
    if (html === null) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    // A second copy of every page must not compete with the live one.
    res.setHeader("X-Robots-Tag", "noindex");
    res.type("html").send(html);
  });

  return router;
}
