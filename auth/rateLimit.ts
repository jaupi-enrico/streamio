import type { Request, RequestHandler, Response, NextFunction } from "express";
import type { Redis as RedisClient } from "../database/redis.js";
import { hashRefreshToken } from "./jwt.js";

interface RateLimitOptions {
  /** Redis client instance */
  redis: RedisClient;
  /** Window duration in seconds */
  windowSeconds: number;
  /** Maximum requests per window */
  max: number;
  /** Key prefix — e.g. "rl:login" */
  prefix: string;
  /** Derive the rate-limit key from the request (default: IP) */
  keyFn?: (req: Request) => string;
  /** Requests this returns true for are passed through uncounted. */
  skip?: (req: Request) => boolean;
}

/**
 * Returns an Express middleware that rate-limits requests using Redis.
 * Uses a simple fixed-window counter stored as a Redis string with TTL.
 */
export function redisRateLimit(opts: RateLimitOptions) {
  const keyFn = opts.keyFn ?? ipKey;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (opts.skip?.(req)) return next();

    const identifier = keyFn(req);
    const key = `${opts.prefix}:${identifier}`;

    try {
      const raw = await opts.redis.get<string>(key);

      const current = raw ? Number(raw) : 0;

      // block
      if (current >= opts.max) {
        res.setHeader("Retry-After", String(opts.windowSeconds));
        res.status(429).json({
          error: "Too Many Requests",
          message: `Rate limit exceeded. Try again in ${opts.windowSeconds} seconds.`,
        });
        return;
      }

      const newCount = current + 1;

      // ALWAYS overwrite as plain string number
      await opts.redis.set(key, String(newCount), opts.windowSeconds);

      res.setHeader("X-RateLimit-Limit", String(opts.max));
      res.setHeader(
        "X-RateLimit-Remaining",
        String(Math.max(0, opts.max - newCount))
      );

      next();
    } catch (err) {
      console.error("[RateLimit] Redis error, failing open:", err);
      next();
    }
  };
}

// ── Pre-configured limiters ───────────────────────────────────────────────────
// Import and use these in your routers.

export function loginLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:login",
    windowSeconds: 60 * 15,  // 15 min window
    max:           10,        // 10 attempts per IP
  });
}

export function registerLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:register",
    windowSeconds: 60 * 60,  // 1 hr window
    max:           5,         // 5 registrations per IP
  });
}

export function oauthLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:oauth",
    windowSeconds: 60 * 5,   // 5 min window
    max:           20,        // 20 OAuth initiations per IP
  });
}

function ipKey(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown"
  );
}

/**
 * Why the two limiters below each come as a *pair*.
 *
 * Keying a budget on a secret the caller supplies (a refresh token, a device
 * code) is right for the honest case — see each one's own comment — but it is
 * not a limit on its own: the key is whatever the request says it is, so an
 * attacker walking the code space sends a different value every time and draws
 * a fresh budget with each guess. That is precisely the traffic these are
 * supposed to bound, and neither endpoint sits behind any other limiter.
 *
 * So the per-secret budget keeps its job (one misbehaving session, throttled
 * without punishing its neighbours) and a per-IP backstop bounds guessing
 * throughput. The backstop is sized well above what a household of honest
 * clients produces, because a 429 on either route reads to a client as a
 * failed sign-in rather than as "slow down".
 */
export function refreshLimiter(redis: RedisClient): RequestHandler[] {
  return [
    // Per IP. A session refreshes at most every 15 minutes, so a single
    // address would need hundreds of live sessions to approach this.
    redisRateLimit({
      redis,
      prefix:        "rl:refresh:ip",
      windowSeconds: 60,
      max:           60,
    }),
    // Per refresh token. Keying this by IP alone punishes the wrong thing: a
    // household behind one NAT, or a single client firing several
    // authenticated calls at once after its access token expired, can trip the
    // limit through no fault of its own — and a 429 here reads to a client as
    // "refresh failed", i.e. a sign-out. Per token, the budget is per session,
    // and a client that has to refresh ten times in a minute really is
    // misbehaving. Requests with no token at all fall back to the IP.
    redisRateLimit({
      redis,
      prefix:        "rl:refresh",
      windowSeconds: 60,        // 1 min window
      max:           10,        // 10 refresh attempts per session
      keyFn:         (req) => {
        const token = req.cookies?.refresh_token || req.body?.refresh_token;
        if (typeof token === "string" && token.length > 0) {
          return `t:${hashRefreshToken(token)}`;
        }

        return `ip:${ipKey(req)}`;
      },
    }),
  ];
}

/** Handing out TV pairing codes. Per IP — nothing is authenticated yet. */
export function deviceStartLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:device:start",
    windowSeconds: 60 * 10,  // 10 min window
    max:           10,        // 10 codes per IP
  });
}

/**
 * Polling for the pairing result. See the note above `refreshLimiter` for why
 * this is a pair rather than the per-device-code budget alone.
 */
export function devicePollLimiter(redis: RedisClient): RequestHandler[] {
  return [
    // Per IP. One honest pairing is ~120 polls (10 minutes at 5s), so this
    // leaves room for several televisions signing in at once behind one NAT
    // while still bounding how fast anyone can walk the user-code space.
    redisRateLimit({
      redis,
      prefix:        "rl:device:poll:ip",
      windowSeconds: 60 * 15,
      max:           1000,
    }),
    // Per device code. A TV polls every 5s for up to 10 minutes — 120 requests
    // for one perfectly well-behaved sign-in — and several devices in a
    // household share one NAT, so an IP budget *alone* would throttle the
    // honest case long before the abusive one.
    redisRateLimit({
      redis,
      prefix:        "rl:device:poll",
      windowSeconds: 60 * 15,  // 15 min window
      max:           200,       // comfortably above 10 min at 5s
      keyFn:         (req) => {
        const code = req.body?.device_code;
        if (typeof code === "string" && code.length > 0) {
          return `d:${hashRefreshToken(code)}`;
        }

        return `ip:${ipKey(req)}`;
      },
    }),
  ];
}

export function shareLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:share",
    windowSeconds: 60 * 5,   // 5 min window
    max:           30,        // 30 shares per user
    keyFn:         (req) => req.user!.sub,
  });
}
// ── General-purpose limiters ─────────────────────────────────────────────────
//
// The limiters above each guard one specific abuse (credential stuffing, mail
// flooding, share spam) and are deliberately tight. These are the opposite:
// broad backstops so that *no* route is completely unbounded, sized well above
// what any honest client does. A page that fires a dozen parallel calls on
// load, or a TV polling every few seconds, must never see one of these.

/**
 * Keyed by account when the caller is authenticated, by IP otherwise.
 *
 * Behind a shared NAT — a household, a school, a corporate egress — a pure IP
 * budget is spent by whoever browses hardest and denies everyone else. Once a
 * request carries a verified token there is a better identity available, so
 * use it. Falls back to IP for anonymous traffic, which is also where the
 * per-IP budget genuinely belongs.
 */
function userOrIpKey(req: Request): string {
  if (req.user?.sub) return `u:${req.user.sub}`;

  return `ip:${ipKey(req)}`;
}

/**
 * Backstop for the signed-in API surface (account library, social, rooms).
 * A busy page load is tens of requests; 600/min leaves an order of magnitude
 * of headroom while still bounding a scripted enumeration of, say, the
 * follower graph.
 */
export function apiLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:api",
    windowSeconds: 60,
    max:           600,
    keyFn:         userOrIpKey,
  });
}

/**
 * Media the browser can only fetch through us (`/api/cast-proxy`).
 *
 * This is the one path where a *single* honest viewer makes hundreds of
 * requests: the proxy rewrites every rendition and every segment URI in an HLS
 * manifest to stay looped through itself, so a two-hour film is thousands of
 * calls, and seeking multiplies that. It is also the path where a 429 does the
 * most damage — hls.js reports it as a fatal network error mid-playback, not
 * as "slow down". So it gets its own budget, an order of magnitude above the
 * rest of the API, rather than sharing one with page navigation.
 */
export function castProxyLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:castproxy",
    windowSeconds: 60,
    max:           6000,
  });
}

/**
 * Backstop for anonymous/public endpoints — static pages, the version
 * handshake, provider catalogues. Higher because a single page load pulls a
 * document plus its assets, and several people share one NAT.
 */
export function publicLimiter(redis: RedisClient, opts: { skip?: (req: Request) => boolean } = {}) {
  return redisRateLimit({
    redis,
    prefix:        "rl:public",
    windowSeconds: 60,
    max:           1000,
    skip:          opts.skip,
  });
}

/**
 * Admin-only routers (server settings, the local-provider library). Every
 * caller here is one authenticated administrator doing one thing at a time;
 * chunked uploads are the only bursty case and they are well inside this.
 */
export function adminLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:admin",
    windowSeconds: 60,
    max:           300,
    keyFn:         userOrIpKey,
  });
}

/**
 * Unauthenticated auth-adjacent endpoints that aren't a login attempt and so
 * don't belong under `loginLimiter`'s 15-minute budget: token redemption
 * (`/verify-email`, `/password-reset/confirm`, `/oauth/exchange`) and the
 * OAuth callback. Each of those consumes a single-use secret, so the thing to
 * bound is guessing throughput.
 */
export function authTokenLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:authtoken",
    windowSeconds: 60 * 10,
    max:           30,
  });
}

/**
 * Binding a TV to an account. Per signed-in user, not per IP: the phone half
 * is authenticated, and the number of televisions one person pairs in ten
 * minutes is small. Bounds an authenticated attacker spraying user codes.
 */
export function deviceClaimLimiter(redis: RedisClient) {
  return redisRateLimit({
    redis,
    prefix:        "rl:device:claim",
    windowSeconds: 60 * 10,
    max:           20,
    keyFn:         userOrIpKey,
  });
}
