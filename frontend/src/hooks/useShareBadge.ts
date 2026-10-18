import { useAuthedQuery } from "../lib/api";
import { getAccessToken } from "../lib/auth";

const POLL_MS = 45_000;

/**
 * Unread-share count for the badge on the "Account" nav link(s) and the
 * account page's Social tab — social.js's initShareBadge(): fetched now,
 * refreshed every 45s while the tab is open, nothing when signed out. A
 * failure keeps the last known count.
 */
export function useShareBadge(enabled = true): number {
  const signedIn = enabled && Boolean(getAccessToken());
  const { data } = useAuthedQuery<{ count: number }>(signedIn ? "/api/social/shares/unread-count" : null, {
    refetchInterval: POLL_MS,
    retry: false,
  });
  return data?.count ?? 0;
}
