import { useEffect, type JSX } from "react";
import { useLocation } from "react-router";
import { usePageScope } from "../hooks/usePageScope";
import { isPreview, oldPageHref } from "../lib/base";
import "./not-ported/not-ported.css";

/**
 * A path this app doesn't serve. In the preview that's a page not ported yet:
 * say so and link to the current version, rather than silently bouncing and
 * hiding that the preview lacks it. On the live site Express only hands this
 * app the pages it serves, so getting here means a stale link — go to the
 * vanilla page.
 */
export function NotPorted(): JSX.Element | null {
  const location = useLocation();
  const target = oldPageHref(`${location.pathname}${location.search}${location.hash}`);
  usePageScope("not-ported", "Not in the preview yet - Streamio");

  useEffect(() => {
    if (!isPreview) window.location.replace(target);
  }, [target]);

  if (!isPreview) return null;
  return (
    <main className="np-main">
      <h1>Not in the preview yet</h1>
      <p>
        <code>{location.pathname}</code> hasn't been ported to the new frontend.
      </p>
      <p>
        <a href={target}>Open the current version →</a>
      </p>
    </main>
  );
}
