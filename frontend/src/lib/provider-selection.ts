/**
 * The visitor's chosen provider slug, shared with the vanilla pages through
 * the same localStorage key. Empty means "the server's default".
 */
export const PROVIDER_STORAGE_KEY = "streamio.provider";

export function getSelectedProvider(): string {
  try {
    return localStorage.getItem(PROVIDER_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setSelectedProvider(slug: string): void {
  try {
    if (slug) localStorage.setItem(PROVIDER_STORAGE_KEY, slug);
    else localStorage.removeItem(PROVIDER_STORAGE_KEY);
  } catch {
    // Storage blocked — the choice lasts for this page only.
  }
}

/** `url` with `?provider=` for the selected provider, when there is one. */
export function withProvider(url: string, provider = getSelectedProvider()): string {
  if (!provider) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}provider=${encodeURIComponent(provider)}`;
}
