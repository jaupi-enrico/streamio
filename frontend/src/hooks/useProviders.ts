import { useEffect } from "react";
import { usePublicQuery } from "../lib/api";
import { rememberCatalog } from "../lib/provider-names";
import type { ProvidersResponse } from "../lib/types";

/**
 * `GET /api/providers` — the only source of provider labels. The catalog is
 * fed to the shared label cache as it arrives, so `getName(slug)` works on
 * pages that never fetch it themselves.
 */
export function useProviders() {
  const query = usePublicQuery<ProvidersResponse>("/api/providers", { staleTime: 5 * 60_000 });
  const catalog = query.data?.catalog;
  useEffect(() => {
    if (catalog) rememberCatalog(catalog);
  }, [catalog]);
  return query;
}
