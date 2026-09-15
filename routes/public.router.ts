import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { Router } from "express";
import path from "node:path";
import { publicLimiter } from "../auth/rateLimit.js";
import type { Redis } from "../database/redis.js";

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

const pageFiles: Record<PublicPage, string> = {
    home: "home.html",
    catalog: "catalog.html",
    search: "search.html",
    providers: "providers.html",
    details: "details.html",
    watch: "watch.html",
    rooms: "rooms.html",
    account: "account.html",
    adminProviders: "admin-providers.html",
    adminLocalProvider: "admin-local-provider.html",
    login: "login.html",
    tv:    "tv.html",
    verifyEmail:   "verify-email.html",
    resetPassword: "reset-password.html"
};

function resolvePublicDir() {
    return path.resolve(process.cwd(), "public");
}

export function createPublicRouter(redis: Redis) {
    const router = Router();
    const publicDir = resolvePublicDir();

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

    router.get("/", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.home));
    });

    router.get("/home", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.home));
    });

    router.get("/catalog", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.catalog));
    });

    router.get("/search", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.search));
    });

    router.get("/providers", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.providers));
    });

    router.get("/details", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.details));
    });

    router.get("/watch", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.watch));
    });

    router.get("/rooms", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.rooms));
    });

    router.get("/account", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.account));
    });

    router.get("/admin/providers", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.adminProviders));
    });

    router.get("/admin/local-provider", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.adminLocalProvider));
    });

    router.get("/login", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.login));
    });

    // Where a television sends its user: short enough to read off a screen and
    // type on a phone. The page itself requires a session (see scripts/tv.js).
    router.get("/tv", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.tv));
    });

    router.get("/auth/callback", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.login)); 
    });

    router.get("/verify-email", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.verifyEmail));
    });

    router.get("/reset-password", limit, (_, res) => {
        res.sendFile(path.join(publicDir, pageFiles.resetPassword));
    });

    return router;
}