/**
 * Token management — a port of public/scripts/auth.js, kept behaviourally
 * identical because both frontends share one session while they run side by
 * side (same sessionStorage key, same cookie, same refresh rules).
 *
 * The server issues:
 *   - access token  → JSON body  { access_token: "..." }   (short-lived JWT)
 *   - refresh token → httpOnly cookie, path "/"             (30 days)
 *
 * The access token lives in sessionStorage so it survives navigation within
 * the tab but is discarded when the tab closes. The refresh token is handled
 * entirely by the browser cookie jar.
 *
 * Only a 401/403 from /api/auth/refresh itself ends a session. A 429, a 5xx,
 * an offline moment or a proxy hiccup leave it alone: the call is retryable.
 */
import { apiUrl } from "./base";
import { pageHref } from "./pages";

const ACCESS_KEY = "streamio.access_token";
/** Also cleared on logout; owned by preferences.ts. */
const PREFS_CACHE_KEY = "streamio.prefs";

export function saveAccessToken(token: string | null | undefined): void {
  if (token) sessionStorage.setItem(ACCESS_KEY, token);
}

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_KEY);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(ACCESS_KEY);
}

interface RefreshAttempt {
  token: string | null;
  /** True only when the server rejected the refresh token (401/403). */
  dead: boolean;
}

let refreshInFlight: Promise<RefreshAttempt> | null = null;

/**
 * One refresh at a time. The server rotates the refresh token on use, so a
 * page that fires several authenticated calls at once (every one of them 401
 * after the access token expires) would otherwise send the same cookie
 * through rotation several times over and race with itself.
 */
function attemptRefresh(): Promise<RefreshAttempt> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<RefreshAttempt> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "include", // sends the httpOnly cookie
    });
  } catch {
    return { token: null, dead: false };
  }

  if (res.ok) {
    const { access_token } = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!access_token) return { token: null, dead: false };
    saveAccessToken(access_token);
    return { token: access_token, dead: false };
  }

  return { token: null, dead: res.status === 401 || res.status === 403 };
}

/**
 * Whether this tab has a session, turning the refresh cookie into an access
 * token if need be. "none" only when the server rejected the refresh (no
 * cookie, expired, revoked); "unreachable" for anything retryable.
 */
export async function restoreSession(): Promise<"ok" | "none" | "unreachable"> {
  if (getAccessToken()) return "ok";
  const attempt = await attemptRefresh();
  if (attempt.token) return "ok";
  return attempt.dead ? "none" : "unreachable";
}

/** A new access token from the refresh cookie, or null on any failure. */
export async function refreshAccessToken(): Promise<string | null> {
  return (await attemptRefresh()).token;
}

/**
 * Restore the session without ever forcing a login. A fresh tab has an empty
 * sessionStorage even when the refresh cookie is good, and the server needs
 * to recognise a signed-in visitor (18+ content) on pages browsable logged
 * out. Never throws, never redirects.
 */
export async function ensureSessionQuietly(): Promise<void> {
  if (getAccessToken()) return;
  await attemptRefresh().catch(() => {});
}

/**
 * fetch for endpoints that serve guests and signed-in users alike: sends the
 * token when there is one, never refreshes, never bounces to /login.
 * `url` is a server path ("/api/…"); the install prefix is added here.
 */
export function fetchPublic(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  return fetch(apiUrl(url), {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

/** RequestInit whose body may also be a plain object, sent as JSON. */
export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | Record<string, unknown> | unknown[] | null;
}

/**
 * Authenticated fetch: attaches the token, refreshes once on a 401 and
 * retries, and sends the browser to /login only when the server itself
 * rejected the refresh token. Any other refresh failure throws and leaves
 * the session alone.
 */
export async function apiFetch(url: string, options: ApiOptions = {}): Promise<Response> {
  let token = getAccessToken();

  if (!token) {
    const attempt = await attemptRefresh();
    if (!attempt.token) {
      if (attempt.dead) {
        redirectToLogin();
        throw new Error("Not authenticated");
      }
      throw new Error("Could not reach the server to renew the session.");
    }
    token = attempt.token;
  }

  const res = await fetchWithToken(url, options, token);
  if (res.status !== 401) return res;

  const attempt = await attemptRefresh();
  if (!attempt.token) {
    if (attempt.dead) {
      redirectToLogin();
      throw new Error("Session expired");
    }
    throw new Error("Could not renew the session. Please try again.");
  }
  token = attempt.token;

  const retried = await fetchWithToken(url, options, token);
  if (retried.status === 401) {
    redirectToLogin();
    throw new Error("Session expired");
  }
  return retried;
}

function fetchWithToken(url: string, options: ApiOptions, token: string): Promise<Response> {
  // FormData must keep the browser's own multipart Content-Type and must not
  // be JSON.stringify'd.
  const isFormData = options.body instanceof FormData;
  const body = options.body;
  return fetch(apiUrl(url), {
    ...options,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
    body:
      isFormData || typeof body === "string"
        ? (body as BodyInit)
        : body
          ? JSON.stringify(body)
          : (body as null | undefined),
  });
}

/** The login page for wherever this copy of the app is mounted. */
export function loginHref(redirect?: string): string {
  const base = pageHref("/login");
  return redirect ? `${base}?redirect=${encodeURIComponent(redirect)}` : base;
}

function redirectToLogin(): void {
  clearAccessToken();
  window.location.href = loginHref(window.location.pathname + window.location.search);
}

/** Revoke the refresh token, clear local state, go to /login. */
export async function logout(): Promise<void> {
  await fetch(apiUrl("/api/auth/logout"), {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
  clearAccessToken();
  try {
    localStorage.removeItem(PREFS_CACHE_KEY);
  } catch {
    // Storage blocked — nothing cached to clear.
  }
  window.location.href = loginHref();
}

/** A non-2xx answer, with the server's status, `reason` and body attached. */
export class ApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  readonly data: Record<string, unknown>;

  constructor(message: string, status: number, reason: string | null, data: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
    this.data = data;
  }
}

/** JSON wrapper around apiFetch. Throws ApiError on non-2xx. */
export async function api<T = unknown>(url: string, options: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(url, options);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
      res.status,
      typeof data.reason === "string" ? data.reason : null,
      data,
    );
  }
  return data as T;
}

let cachedSelfId: string | null = null;

/** Current user's id, fetched once per page load. Null if logged out. */
export async function getSelfId(): Promise<string | null> {
  if (cachedSelfId || !getAccessToken()) return cachedSelfId;
  try {
    const me = await api<{ id?: string }>("/api/account/me");
    cachedSelfId = me?.id || null;
  } catch {
    cachedSelfId = null;
  }
  return cachedSelfId;
}

/** Library rows are cached per (provider, show_id); the key format lives here. */
export function showKey(provider: string, showId: string): string {
  return `${provider}:${showId}`;
}

/**
 * Splits on the FIRST colon only: a provider slug never contains one, but a
 * show id may (ids are opaque, and some are or were URLs).
 */
export function parseShowKey(key: string | null | undefined): { provider: string; showId: string } {
  const s = String(key ?? "");
  const at = s.indexOf(":");
  if (at < 0) return { provider: s, showId: "" };
  return { provider: s.slice(0, at), showId: s.slice(at + 1) };
}
