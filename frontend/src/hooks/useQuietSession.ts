import { useEffect, useState } from "react";
import { ensureSessionQuietly, getAccessToken } from "../lib/auth";

let restoring: Promise<void> | null = null;

/**
 * `await ensureSessionQuietly()` for a component: true once a fresh tab has
 * had its chance to turn the refresh cookie into an access token. Pages whose
 * content depends on who is asking (18+, the provider list) wait for it
 * before fetching, exactly as the vanilla pages awaited it at the top. Never
 * redirects; failing just means browsing as a guest.
 */
export function useQuietSession(): boolean {
  const [ready, setReady] = useState(() => Boolean(getAccessToken()));
  useEffect(() => {
    if (ready) return;
    let alive = true;
    restoring ??= ensureSessionQuietly().finally(() => {
      restoring = null;
    });
    void restoring.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}
