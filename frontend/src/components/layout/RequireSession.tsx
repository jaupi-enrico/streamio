import { useEffect, useState, type JSX } from "react";
import { Outlet } from "react-router";
import { loginHref, restoreSession } from "../../lib/auth";

type State = "checking" | "ok" | "unreachable";

/**
 * Layout route for pages that need a signed-in visitor. A fresh tab first
 * gets its chance to restore the session from the refresh cookie; only a
 * refresh the server rejected sends the browser to /login. A network
 * failure leaves the session alone and offers a retry instead.
 *
 * This hides the pages, not the data: the catalogue endpoints stay
 * optionalAuth because the Cast receiver and the app call them too.
 */
export function RequireSession(): JSX.Element | null {
  const [state, setState] = useState<State>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void restoreSession().then((result) => {
      if (!alive) return;
      if (result === "none") {
        window.location.replace(loginHref(window.location.pathname + window.location.search));
        return;
      }
      setState(result);
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (state === "ok") return <Outlet />;
  if (state === "checking") return null;
  return (
    <div style={{ padding: "4rem 1rem", textAlign: "center" }}>
      <p>Could not reach the server to restore your session.</p>
      <button
        type="button"
        onClick={() => {
          setState("checking");
          setAttempt((n) => n + 1);
        }}
      >
        Retry
      </button>
    </div>
  );
}
