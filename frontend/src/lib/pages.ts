/**
 * Which pages this app implements, and where a link to any page should go.
 *
 * Kept apart from routes.tsx (which maps these paths to components) so
 * non-UI modules — auth.ts's redirect to /login, for one — can ask "is this
 * page here?" without importing every page.
 *
 * While the migration runs, a page exists in one of three places:
 *  - here, under /preview, as soon as it is ported;
 *  - here, on the live site, once it is listed in REACT_PAGES;
 *  - only in the vanilla frontend otherwise.
 * `pageHref()` picks the right one, so a preview page links to other preview
 * pages where they exist and falls back to the old page where they don't.
 */
import { appPageHref, config, isPreview, oldPageHref } from "./base";

/**
 * Page key → the path(s) it serves. The key is what REACT_PAGES lists and
 * must match `PublicPage` names in routes/public.router.ts.
 */
export const IMPLEMENTED_PAGES: Record<string, readonly string[]> = {
  login: ["/login", "/auth/callback"],
  verifyEmail: ["/verify-email"],
  resetPassword: ["/reset-password"],
  tv: ["/tv"],
  rooms: ["/rooms"],
  providers: ["/providers"],
  catalog: ["/catalog"],
  search: ["/search"],
  home: ["/", "/home"],
  details: ["/details"],
  account: ["/account"],
  adminProviders: ["/admin/providers"],
  adminLocalProvider: ["/admin/local-provider"],
  watch: ["/watch"],
};

const pathToPage = new Map<string, string>(
  Object.entries(IMPLEMENTED_PAGES).flatMap(([page, paths]) => paths.map((p) => [p, page] as const)),
);

/** The page key a pathname belongs to, if this app implements it. */
export function pageForPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  return pathToPage.get(clean) ?? null;
}

/** Whether a link to `path` can stay inside this app (client-side routing). */
export function isInApp(path: string): boolean {
  const page = pageForPath(path.split(/[?#]/)[0] ?? "/");
  if (!page) return false;
  return isPreview || config.livePages.includes(page);
}

/**
 * Full href for a page path ("/details?id=…"): this app's copy when it has
 * one, the vanilla page otherwise.
 */
export function pageHref(path: string): string {
  return isInApp(path) ? appPageHref(path) : oldPageHref(path);
}
