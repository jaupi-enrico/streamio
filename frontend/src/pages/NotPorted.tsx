import type { JSX } from "react";
import { useLocation } from "react-router";
import { usePageScope } from "../hooks/usePageScope";
import "./not-ported/not-ported.css";

/** A path this app doesn't serve (a stale link, or a typo). */
export function NotPorted(): JSX.Element {
  const location = useLocation();
  usePageScope("not-ported", "Page not found - Streamio");

  return (
    <main className="np-main">
      <h1>Page not found</h1>
      <p>
        <code>{location.pathname}</code> doesn't exist.
      </p>
      <p>
        <a href="/">Back to home →</a>
      </p>
    </main>
  );
}
