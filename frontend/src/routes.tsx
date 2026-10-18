/**
 * Route table: which component serves each page path. Which paths exist at
 * all is lib/pages.ts (IMPLEMENTED_PAGES) — the two must agree, which the
 * check at the bottom enforces at startup in development.
 *
 * Paths and query parameters are those of the original vanilla site, so
 * existing links and bookmarks keep working.
 */
import { lazy, Suspense, type ComponentType, type JSX } from "react";
import type { RouteObject } from "react-router";
import { Shell } from "./Shell";
import { NotPorted } from "./pages/NotPorted";
import { IMPLEMENTED_PAGES } from "./lib/pages";

// One chunk per page, so a page's stylesheet and code load only when visited.
const LoginPage = lazy(() => import("./pages/login/LoginPage"));
const VerifyEmailPage = lazy(() => import("./pages/verify-email/VerifyEmailPage"));
const ResetPasswordPage = lazy(() => import("./pages/reset-password/ResetPasswordPage"));
const TvPage = lazy(() => import("./pages/tv/TvPage"));
const RoomsPage = lazy(() => import("./pages/rooms/RoomsPage"));
const ProvidersPage = lazy(() => import("./pages/providers/ProvidersPage"));
const CatalogPage = lazy(() => import("./pages/catalog/CatalogPage"));
const SearchPage = lazy(() => import("./pages/search/SearchPage"));
const HomePage = lazy(() => import("./pages/home/HomePage"));
const DetailsPage = lazy(() => import("./pages/details/DetailsPage"));
const AccountPage = lazy(() => import("./pages/account/AccountPage"));
const AdminProvidersPage = lazy(() => import("./pages/admin-providers/AdminProvidersPage"));
const AdminLocalProviderPage = lazy(() => import("./pages/admin-local-provider/AdminLocalProviderPage"));
const WatchPage = lazy(() => import("./pages/watch/WatchPage"));

function page(Component: ComponentType): JSX.Element {
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}

const PAGE_ROUTES: Record<string, RouteObject[]> = {
  login: [
    { path: "/login", element: page(LoginPage) },
    { path: "/auth/callback", element: page(LoginPage) },
  ],
  verifyEmail: [{ path: "/verify-email", element: page(VerifyEmailPage) }],
  resetPassword: [{ path: "/reset-password", element: page(ResetPasswordPage) }],
  tv: [{ path: "/tv", element: page(TvPage) }],
  rooms: [{ path: "/rooms", element: page(RoomsPage) }],
  providers: [{ path: "/providers", element: page(ProvidersPage) }],
  catalog: [{ path: "/catalog", element: page(CatalogPage) }],
  search: [{ path: "/search", element: page(SearchPage) }],
  home: [
    { path: "/", element: page(HomePage) },
    { path: "/home", element: page(HomePage) },
  ],
  details: [{ path: "/details", element: page(DetailsPage) }],
  account: [{ path: "/account", element: page(AccountPage) }],
  adminProviders: [{ path: "/admin/providers", element: page(AdminProvidersPage) }],
  adminLocalProvider: [{ path: "/admin/local-provider", element: page(AdminLocalProviderPage) }],
  watch: [{ path: "/watch", element: page(WatchPage) }],
};

export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [...Object.values(PAGE_ROUTES).flat(), { path: "*", element: <NotPorted /> }],
  },
];

if (import.meta.env.DEV) {
  for (const [key, paths] of Object.entries(IMPLEMENTED_PAGES)) {
    const routed = (PAGE_ROUTES[key] ?? []).map((r) => r.path);
    if (paths.some((p) => !routed.includes(p)) || routed.length !== paths.length) {
      console.error(`[routes] lib/pages.ts and routes.tsx disagree about "${key}"`, paths, routed);
    }
  }
}
