import type { JSX } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { PreviewBanner } from "./components/layout/PreviewBanner";
import { ShareModalHost } from "./components/social/ShareModal";

/** Wraps every page: shared modal host, scroll restoration, preview banner. */
export function Shell(): JSX.Element {
  return (
    <ShareModalHost>
      <Outlet />
      <ScrollRestoration />
      <PreviewBanner />
    </ShareModalHost>
  );
}
