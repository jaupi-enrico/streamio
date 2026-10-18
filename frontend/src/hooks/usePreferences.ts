import { useEffect, useSyncExternalStore } from "react";
import { getPreferencesSnapshot, loadPreferences, subscribePreferences, type Preferences } from "../lib/preferences";

/** Current common preferences; re-renders when the cache changes. */
export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribePreferences, getPreferencesSnapshot, getPreferencesSnapshot);
}

/**
 * Fetches the signed-in values on mount — for the pages whose vanilla
 * version called `loadPreferences()`. The cached values already applied at
 * startup (main.tsx); this refreshes them from the server.
 */
export function useLoadPreferences(): void {
  useEffect(() => {
    void loadPreferences();
  }, []);
}
