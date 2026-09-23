import { useState, type JSX } from "react";
import { useLocation } from "react-router";
import { isPreview, oldPageHref } from "../../lib/base";
import "../../styles/preview-banner.css";

const DISMISS_KEY = "streamio.previewBanner.dismissed";

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shown only on the /preview copy: marks the page as the new version and
 * opens the same page of the current site in a new tab, for comparing side by
 * side. Dismissed per tab.
 */
export function PreviewBanner(): JSX.Element | null {
  const location = useLocation();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!isPreview || dismissed) return null;

  const current = oldPageHref(`${location.pathname}${location.search}${location.hash}`);
  return (
    <div className="sp-preview-banner" role="note">
      <span className="sp-preview-tag">Preview</span>
      <a href={current} target="_blank" rel="noopener">
        Open current version ↗
      </a>
      <button
        type="button"
        aria-label="Hide preview banner"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            // Storage blocked — hidden until the next load.
          }
          setDismissed(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
