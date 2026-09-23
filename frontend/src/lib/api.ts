/**
 * TanStack Query wiring. Every GET the pages make goes through one of the two
 * hooks here, so caching, retries and the auth split are decided once:
 *
 *  - `usePublicQuery` — endpoints browsable logged out (fetchPublic: token
 *    attached when present, never refreshes or redirects).
 *  - `useAuthedQuery` — endpoints that need a session (api(): refreshes once,
 *    redirects to /login only on a dead refresh token).
 *
 * Never cached, by rule: `POST /api/episodes/:id/video`. Resolved streams are
 * signed URLs that expire in minutes, so that call is a plain async function
 * made fresh per playback attempt, not a query.
 */
import { QueryClient, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { ApiError, api, fetchPublic } from "./auth";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx is an answer (gated, not found, bad input), not a hiccup.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** fetchPublic + JSON, throwing ApiError on non-2xx like api() does. */
export async function publicJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchPublic(url, init);
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

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn">;

export function usePublicQuery<T>(url: string | null, options: QueryOpts<T> = {}) {
  return useQuery<T, Error, T, readonly unknown[]>({
    queryKey: ["public", url],
    queryFn: ({ signal }) => publicJson<T>(url as string, { signal }),
    enabled: url !== null && (options.enabled ?? true),
    ...options,
  });
}

export function useAuthedQuery<T>(url: string | null, options: QueryOpts<T> = {}) {
  return useQuery<T, Error, T, readonly unknown[]>({
    queryKey: ["authed", url],
    queryFn: ({ signal }) => api<T>(url as string, { signal }),
    enabled: url !== null && (options.enabled ?? true),
    ...options,
  });
}

/**
 * Result of fetching a title that may sit behind the 18+ gate. Only "gated"
 * is permanent — the library views drop that row, as account.js's fetchShow
 * does. "unavailable" (404, empty body, network) is left for a later retry.
 */
export type ShowResult<T> = { kind: "ok"; show: T } | { kind: "gated" } | { kind: "unavailable" };

/** `GET /api/shows/:id` for the signed-in library views. */
export async function fetchShow<T extends { title?: unknown }>(
  provider: string,
  showId: string,
): Promise<ShowResult<T>> {
  try {
    const data = await api<T | { data?: T }>(
      `/api/shows/${encodeURIComponent(showId)}?provider=${encodeURIComponent(provider)}`,
    );
    const show = ((data as { data?: T }).data ?? data) as T;
    return show && show.title ? { kind: "ok", show } : { kind: "unavailable" };
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return { kind: "gated" };
    return { kind: "unavailable" };
  }
}
