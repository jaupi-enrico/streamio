/**
 * The phone half of the TV sign-in flow (auth/deviceLogin.ts) — a port of
 * public/tv.html + scripts/tv.js.
 *
 * The television shows a code and polls; this page is where a signed-in user
 * approves it. Everything security-relevant is server-side: `/device/claim`
 * is behind requireAuth, and the account it binds is whoever is signed in
 * here, never anything this page sends.
 */
import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { AppLink } from "../../components/layout/AppLink";
import { Spinner } from "../../components/ui/Spinner";
import { api, apiFetch } from "../../lib/auth";
import { AuthShell, StatusBadge } from "../auth-pages/AuthShell";
import { normalizeUserCode } from "./device-code";

type Panel = "loading" | "form" | "success";

export default function TvPage(): JSX.Element {
  const [panel, setPanel] = useState<Panel>("loading");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Confirm the session before anything else, so the code entry is never
  // shown to someone about to be bounced to /login. apiFetch bounces to
  // /login?redirect=… when there is no session — signing in and coming back
  // lands here with the code intact.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await apiFetch("/api/account/me");
      } catch {
        if (cancelled) return;
        setError("Could not reach the server. Check your connection and reload.");
        setPanel("form");
        return;
      }
      if (cancelled) return;
      // The TV's QR code points at ?code=…, so the common path arrives with
      // the code filled in. It still needs an explicit confirmation —
      // approving an account binding silently on load is exactly the phishing
      // case the warning copy is about.
      const fromUrl = new URLSearchParams(location.search).get("code");
      if (fromUrl) setCode(normalizeUserCode(fromUrl));
      setPanel("form");
      requestAnimationFrame(() => input.current?.focus());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onInput(el: HTMLInputElement) {
    const atEnd = el.selectionStart === el.value.length;
    const next = normalizeUserCode(el.value);
    setCode(next);
    if (atEnd) {
      requestAnimationFrame(() => {
        if (input.current) input.current.setSelectionRange(next.length, next.length);
      });
    }
  }

  async function claim(userCode: string) {
    setError(null);
    setBusy(true);
    try {
      const data = await api<{ label?: string }>("/api/auth/device/claim", {
        method: "POST",
        body: { user_code: userCode },
      });
      setLabel(data.label || null);
      setPanel("success");
    } catch (err) {
      setError((err instanceof Error && err.message) || "Could not sign in that TV.");
      setPanel("form");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeUserCode(code);
    if (normalized.length < 9) {
      setError("That code looks incomplete. It has eight characters.");
      return;
    }
    void claim(normalized);
  }

  return (
    <AuthShell title="Sign in a TV - Streamio">
      <div className={`panel${panel === "loading" ? " active" : ""}`} id="panelLoading">
        <h1 className="auth-heading">Sign in a TV</h1>
        <div className="verifying">
          <Spinner />
          <p>Checking your session…</p>
        </div>
      </div>

      <div className={`panel${panel === "form" ? " active" : ""}`} id="panelForm">
        <h1 className="auth-heading">Sign in a TV</h1>
        <p className="auth-sub">Enter the code shown on your television.</p>

        <div className={`error-msg${error ? " show" : ""}`} id="formError">
          {error}
        </div>

        <form id="codeForm" onSubmit={onSubmit}>
          <div className="field">
            <label className="field-label" htmlFor="userCode">
              Code from your TV
            </label>
            <input
              ref={input}
              className="field-input code-input"
              id="userCode"
              type="text"
              placeholder="XXXX-XXXX"
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              value={code}
              onChange={(e) => onInput(e.target)}
            />
          </div>
          <button className="btn-submit" type="submit" id="codeSubmit" disabled={busy}>
            {busy ? <Spinner /> : "Sign in my TV"}
          </button>
        </form>

        {/* The standing risk of any device flow: someone reads you a code and
            you hand them your account. This is the only place to catch it. */}
        <p className="hint">
          Only continue if you are looking at this code on your own TV. Never enter a code someone sent you or read out
          to you — it signs <strong>their</strong> device into <strong>your</strong> account.
        </p>

        <div className="auth-footer">
          <AppLink to="/account">← Back to your account</AppLink>
        </div>
      </div>

      <div className={`panel panel-centered${panel === "success" ? " active" : ""}`} id="panelSuccess">
        <StatusBadge />
        <h1 className="auth-heading">Your TV is signed in</h1>
        <p className="auth-sub" id="successSub">
          {label ? (
            <>
              <strong>{label}</strong> is now signed in. You can put the remote down — it will continue on its own.
            </>
          ) : (
            "You can put the remote down — the TV will continue on its own."
          )}
        </p>
        <AppLink className="btn-submit" to="/">
          Back to Streamio
        </AppLink>
      </div>
    </AuthShell>
  );
}
