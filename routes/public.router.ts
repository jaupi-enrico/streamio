import express, { Router } from "express";
import { publicLimiter } from "../auth/rateLimit.js";
import type { Redis } from "../database/redis.js";
import type { WebPlatformHandler } from "../PlatformHandler.js";
import { frontendAssets, renderAppIndex } from "./frontend-app.js";
import { createDetailsOgRenderer } from "./og-meta.js";

type PublicPage =
    | "home"
    | "catalog"
    | "search"
    | "providers"
    | "details"
    | "watch"
    | "rooms"
    | "account"
    | "adminProviders"
    | "adminLocalProvider"
    | "login"
    | "tv"
    | "verifyEmail"
    | "resetPassword";

export function createPublicRouter(redis: Redis, platformHandler: WebPlatformHandler) {
    const router = Router();

    // These are static HTML documents, so the cost of serving one is small —
    // but they are the only unauthenticated, uncached entry points on the
    // server, and nothing else bounds how fast one address can ask for them.
    // The budget is per IP and deliberately loose: a page load pulls one
    // document here (its assets come from express.static), so a person
    // clicking around never approaches it.
    //
    // Attached per route rather than with `router.use`, which would be a bug
    // here: this router is mounted at "/" *above* the API mounts (server.ts),
    // so router-level middleware runs for every request that merely passes
    // through on its way to /api — including the thousands of segment fetches
    // one film pulls through /api/cast-proxy, which would spend this budget
    // and throttle playback.
    const limit = publicLimiter(redis);

    const detailsOgTags = createDetailsOgRenderer(platformHandler, redis);

    // Bundle files at the root (the live mount's <base> is "/"). Only these
    // prefixes, so an API request passing through never costs a stat.
    // /icons is also in public/, which is served first and wins.
    const assets = frontendAssets();
    for (const prefix of ["/assets", "/vendor", "/icons"]) {
        router.use(prefix, (req, res, next) => {
            req.url = prefix + req.url;
            assets(req, res, (err?: unknown) => {
                req.url = req.url.slice(prefix.length);
                next(err);
            });
        });
    }

    const page = (name: PublicPage): express.RequestHandler => async (req, res, next) => {
        try {
            const headExtra = name === "details"
                ? await detailsOgTags(req.query as Record<string, unknown>)
                : "";
            const html = renderAppIndex({
                mount: "",
                requestPath: req.originalUrl.split("?")[0] ?? "/",
                headExtra,
            });
            if (html === null) {
                res.status(503).type("text/plain").send("The frontend has not been built (npm run build).");
                return;
            }
            res.setHeader("Cache-Control", "no-cache");
            res.type("html").send(html);
        } catch (err) {
            next(err);
        }
    };

    router.get("/", limit, page("home"));

    router.get("/home", limit, page("home"));

    router.get("/catalog", limit, page("catalog"));

    router.get("/search", limit, page("search"));

    router.get("/providers", limit, page("providers"));

    router.get("/details", limit, page("details"));

    router.get("/watch", limit, page("watch"));

    router.get("/rooms", limit, page("rooms"));

    router.get("/account", limit, page("account"));

    router.get("/admin/providers", limit, page("adminProviders"));

    router.get("/admin/local-provider", limit, page("adminLocalProvider"));

    router.get("/login", limit, page("login"));

    // Where a television sends its user: short enough to read off a screen and
    // type on a phone. The page itself requires a session (see scripts/tv.js).
    router.get("/tv", limit, page("tv"));

    router.get("/auth/callback", limit, page("login"));

    router.get("/verify-email", limit, page("verifyEmail"));

    router.get("/reset-password", limit, page("resetPassword"));

    return router;
}