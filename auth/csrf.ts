// csrf.ts
//
// Cross-site request forgery protection for the one thing on this server that
// is authenticated by a cookie.
//
// Almost every API route authenticates with `Authorization: Bearer` — a header
// a cross-origin page cannot make the browser attach — so those routes are
// structurally immune. The exceptions are `POST /api/auth/refresh` and
// `POST /api/auth/logout`, which read the httpOnly `refresh_token` cookie, and
// that cookie *is* attached automatically on a cross-site form POST.
// `SameSite=Lax` already stops that in every current browser, but it is one
// cookie attribute standing between an attacker's page and a fresh session.
//
// ── Why this checks Sec-Fetch-Site and not Origin-vs-Host ──────────────────
//
// The obvious guard — reject when `Origin` names a different host than the one
// the request was sent to — cannot be relied on here. An install's public
// hostname can change (it is whatever the operator points at this app, and
// some setups rotate it), and a reverse proxy in front of the app may rewrite
// the `Host` header to the internal target before we ever see it. A browser on
// the public hostname would therefore always look "cross-origin" to us, and
// every refresh would 403 — which both clients read as a dead session, i.e. a
// silent sign-out for everyone. A static origin allowlist has the same problem
// from the other side: it would be stale the next time the public hostname
// changed.
//
// `Sec-Fetch-Site` is set by the browser itself, describes the relationship
// between the initiator and the target, and is on the forbidden-header list so
// no page script can forge it. It says what we actually want to know without
// either side having to agree on what the public hostname is today.
//
// What deliberately still passes:
//
//   - Requests with no `Sec-Fetch-Site` at all. Native clients (the Flutter
//     app, the TV, the Cast receiver's server-side calls, curl) send none, and
//     they authenticate by Bearer/body rather than by cookie — there is no
//     ambient credential to forge. Every browser that would attach a cookie
//     cross-site also sends this header.
//   - Safe methods (GET/HEAD/OPTIONS), which must never change state anyway.
//   - The endpoints on the allowlist below, which a legitimate third-party
//     origin calls: the Cast receiver is a static page on its own origin and
//     POSTs to `/api/episodes/:id/video` and `/api/cast-log`, and peers pull
//     `/api/sync/*` with a shared secret. None of them read a cookie, so a
//     forged call achieves exactly what calling them directly achieves.
import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `Sec-Fetch-Site` values that mean "this did not come from another site". */
const SAME_SITE_VALUES = new Set(["same-origin", "same-site", "none"]);

const CROSS_ORIGIN_ALLOWED = [
  /^\/api\/cast-log$/,
  /^\/api\/cast-proxy$/,
  /^\/api\/episodes\/[^/]+\/video$/,
  /^\/api\/sync(\/|$)/,
];

/**
 * Rejects state-changing requests a browser tells us were initiated by another
 * site. Registered once, app-wide, immediately after the cookie parser.
 */
export function csrfGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const site = req.get("sec-fetch-site")?.toLowerCase();
    // No header: not a browser, so no ambient cookie to abuse.
    if (!site) return next();
    if (SAME_SITE_VALUES.has(site)) return next();

    if (CROSS_ORIGIN_ALLOWED.some((re) => re.test(req.path))) return next();

    res.status(403).json({ error: "Cross-site request rejected." });
  };
}
