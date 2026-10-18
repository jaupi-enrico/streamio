import type { JSX } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { ShareModalHost } from "./components/social/ShareModal";

/** Wraps every page: shared modal host, scroll restoration. */
export function Shell(): JSX.Element {
  return (
    <ShareModalHost>
      <Outlet />
      <ScrollRestoration />
    </ShareModalHost>
  );
}
