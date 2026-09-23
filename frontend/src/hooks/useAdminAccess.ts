import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../lib/auth";

export type AdminAccess = "yes" | "no" | "unknown";

/**
 * Whether this account may use the admin pages.
 *
 * There is no admin flag on the user object, so a 403 from an admin-gated
 * endpoint is the only signal. The third case matters: a transient 503 (the
 * server can't reach its database) must not read as a refusal and bounce a
 * real admin away — "unknown" keeps them where they are and says what
 * happened.
 */
export function useAdminAccess(enabled = true) {
  return useQuery<AdminAccess>({
    queryKey: ["admin-access"],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        await api("/api/settings/sync");
        return "yes";
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) return "no";
        return "unknown";
      }
    },
  });
}
