/**
 * The frame shared by verify-email, reset-password and tv — the vanilla pages'
 * common markup around one `.auth-card`, styled by auth-pages.css (scope
 * "auth-pages").
 */
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { AppLink } from "../../components/layout/AppLink";
import { usePageScope } from "../../hooks/usePageScope";
import { pageHref } from "../../lib/pages";
import "./auth-pages.css";

export function AuthShell({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  usePageScope("auth-pages", title);
  return (
    <>
      <div className="bg-canvas" />
      <div className="bg-grid" />
      <nav>
        <AppLink to="/" className="brand">
          STREAMIO
        </AppLink>
      </nav>
      <main>
        <div className="auth-card">{children}</div>
      </main>
    </>
  );
}

/** The green check in a success panel. */
export function StatusBadge(): JSX.Element {
  return (
    <div className="status-badge">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </div>
  );
}

/**
 * The emailed link points at whatever public URL the server had when it was
 * sent, and on an install whose hostname moves that host can already be dead —
 * so people paste the whole broken URL as often as the bare code. Pull the
 * token out of either.
 */
export function normalizeCode(raw: string): string {
  const value = raw.trim();
  const match = value.match(/[?&]token=([^&\s]+)/);
  return match ? decodeURIComponent(match[1] ?? "") : value;
}

const REDIRECT_SECONDS = 3;

/**
 * "Redirecting in 3s…" and then /login, once `active` turns true. Returns the
 * note text ("" while inactive).
 */
export function useRedirectToLogin(active: boolean): string {
  const [left, setLeft] = useState(REDIRECT_SECONDS);
  useEffect(() => {
    if (!active) return;
    setLeft(REDIRECT_SECONDS);
    let remaining = REDIRECT_SECONDS;
    const tick = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(tick);
        location.href = pageHref("/login");
        return;
      }
      setLeft(remaining);
    }, 1000);
    return () => clearInterval(tick);
  }, [active]);
  return active ? `Redirecting in ${left}s…` : "";
}
