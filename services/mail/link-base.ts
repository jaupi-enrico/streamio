// services/mail/link-base.ts
//
// Which base URL a verification/reset link should point at: `APP_URL`, or a
// live one asked for at send time when this install has a front end whose
// hostname moves.
//
// If this install sits behind a reverse proxy with a hostname that can change
// (a dynamic-DNS setup, a proxy handed a fresh hostname on each restart),
// `APP_URL` can go stale between when a mail is sent and when it's clicked.
// Set `REDIRECT_URL` to something exposing `GET /status` -> `{ tunnel, alive }`
// and the current hostname is read from there per send instead. Unset — the
// default, and every install with a fixed hostname — means `APP_URL` is used
// as-is and nothing is probed.
//
// The hostname can still rotate between sending and clicking, which no
// server-side lookup can fix — that is why every such email also carries the
// raw token for manual entry (see `MailService`).

import axios from "axios";
import { appBaseUrl } from "../../version.js";

/** Unset means no such service: `APP_URL` stands and nothing is probed. */
const REDIRECT_URL = (process.env.REDIRECT_URL ?? "").replace(/\/+$/, "");

const CACHE_TTL_MS = 30_000; // short: the hostname can change at any time
const PROBE_TIMEOUT_MS = 2000;

interface TunnelStatus {
  tunnel: string | null;
  alive: boolean;
}

// In-process rather than in Redis: at a 30s TTL this is one request per
// process to a container on the same network, which is cheaper than threading
// a Redis handle through `MailService` for it.
let cached: { base: string; at: number } | null = null;

/**
 * The public base URL to build email links from: the live one when a
 * `REDIRECT_URL` service reports a tunnel up, `APP_URL` otherwise. Never
 * throws — a mail must not fail because that service is down or absent.
 */
export async function resolvePublicBase(): Promise<string> {
  const fallback = appBaseUrl();
  if (!REDIRECT_URL) return fallback;

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.base;

  let base = fallback;

  try {
    const res = await axios.get<TunnelStatus>(`${REDIRECT_URL}/status`, {
      timeout: PROBE_TIMEOUT_MS,
    });

    // `alive` and not merely present: the service reports a tunnel URL as soon
    // as it has one, before it resolves. A link built from a hostname that is
    // still propagating is worse than a stale one — it 404s for the recipient
    // instead of landing somewhere.
    if (res.data?.alive && res.data.tunnel) {
      base = res.data.tunnel.replace(/\/+$/, "");
    }
  } catch {
    // Not reachable from here, or not running at all — `APP_URL` stands.
  }

  cached = { base, at: Date.now() };
  return base;
}
