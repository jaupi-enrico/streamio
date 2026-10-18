/**
 * Email verification — a port of public/verify-email.html + scripts/
 * verify-email.js. Auto-verifies a `?token=` and otherwise shows the
 * paste-a-code / resend panel. That fallback is the common path, not an edge
 * case: the emailed link can point at a hostname that no longer exists.
 */
import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { AppLink } from "../../components/layout/AppLink";
import { Spinner } from "../../components/ui/Spinner";
import { apiUrl } from "../../lib/base";
import { AuthShell, StatusBadge, normalizeCode, useRedirectToLogin } from "../auth-pages/AuthShell";

type Panel = "verifying" | "success" | "manual";
type Notice = { kind: "error" | "success"; text: string } | null;

const DEFAULT_SUB = "Paste the code from your verification email.";
const EXPIRED_SUB =
  "That link has expired or was already used. Paste the code from your email, or request a new one.";

/** One verification per token: StrictMode would otherwise POST it twice in dev. */
let verifiedUrlToken: string | null = null;

export default function VerifyEmailPage(): JSX.Element {
  const [urlToken] = useState(() => new URLSearchParams(location.search).get("token"));
  const [panel, setPanel] = useState<Panel>(urlToken ? "verifying" : "manual");
  const [sub, setSub] = useState(DEFAULT_SUB);
  const [notice, setNotice] = useState<Notice>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const tokenInput = useRef<HTMLInputElement>(null);
  const redirectNote = useRedirectToLogin(panel === "success");

  async function verify(token: string, fromUrl = false) {
    if (fromUrl) setPanel("verifying");

    let res: Response;
    let data: { error?: string; message?: string };
    try {
      res = await fetch(apiUrl("/api/auth/verify-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      data = (await res.json()) as typeof data;
    } catch {
      setPanel("manual");
      setNotice({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
      return;
    }

    if (res.ok) {
      setPanel("success");
      return;
    }

    setPanel("manual");
    setSub(EXPIRED_SUB);
    setNotice({ kind: "error", text: data.error ?? data.message ?? "Verification failed." });
    if (fromUrl) requestAnimationFrame(() => tokenInput.current?.focus());
  }

  useEffect(() => {
    if (urlToken) {
      if (verifiedUrlToken === urlToken) return;
      verifiedUrlToken = urlToken;
      void verify(urlToken, true);
    } else {
      tokenInput.current?.focus();
    }
    // Once per visit, for the token the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onManual(e: FormEvent) {
    e.preventDefault();
    const token = normalizeCode(code);
    if (!token) {
      setNotice({ kind: "error", text: "Paste the code from your verification email." });
      return;
    }
    setVerifyBusy(true);
    try {
      await verify(token);
    } finally {
      setVerifyBusy(false);
    }
  }

  async function onResend(e: FormEvent) {
    e.preventDefault();
    setResendBusy(true);
    try {
      const res = await fetch(apiUrl("/api/auth/verify-email/resend"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (res.ok) setNotice({ kind: "success", text: data.message ?? "A new link is on its way." });
      else setNotice({ kind: "error", text: data.error ?? "Could not send a new link." });
    } catch {
      setNotice({ kind: "error", text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <AuthShell title="Verify Email - Streamio">
      <div className={`panel${panel === "verifying" ? " active" : ""}`} id="panelVerifying">
        <h1 className="auth-heading">Verifying</h1>
        <div className="verifying">
          <Spinner />
          <p>Checking your verification link…</p>
        </div>
      </div>

      <div className={`panel panel-centered${panel === "success" ? " active" : ""}`} id="panelSuccess">
        <StatusBadge />
        <h1 className="auth-heading">Email verified</h1>
        <p className="auth-sub">Your account is ready. Time to watch something.</p>
        <AppLink className="btn-submit" to="/login">
          Go to sign in
        </AppLink>
        <p className="redirect-note" id="redirectNote">
          {redirectNote}
        </p>
      </div>

      <div className={`panel${panel === "manual" ? " active" : ""}`} id="panelManual">
        <h1 className="auth-heading">Verify your email</h1>
        <p className="auth-sub" id="manualSub">
          {sub}
        </p>

        <div className={`error-msg${notice?.kind === "error" ? " show" : ""}`} id="manualError">
          {notice?.kind === "error" ? notice.text : ""}
        </div>
        <div className={`success-msg${notice?.kind === "success" ? " show" : ""}`} id="manualSuccess">
          {notice?.kind === "success" ? notice.text : ""}
        </div>

        <form id="manualForm" onSubmit={onManual}>
          <div className="field">
            <label className="field-label" htmlFor="token">
              Verification code
            </label>
            <input
              ref={tokenInput}
              className="field-input code-input"
              id="token"
              type="text"
              placeholder="Paste your code here"
              required
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button className="btn-submit" type="submit" id="manualSubmit" disabled={verifyBusy}>
            {verifyBusy ? <Spinner /> : "Verify"}
          </button>
        </form>

        <div className="divider">didn't get the email?</div>

        <form id="resendForm" onSubmit={onResend}>
          <div className="field">
            <label className="field-label" htmlFor="email">
              Email address
            </label>
            <input
              className="field-input"
              id="email"
              type="email"
              placeholder="your@email.com"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button className="btn-ghost" type="submit" id="resendSubmit" disabled={resendBusy}>
            {resendBusy ? <Spinner /> : "Send a new link"}
          </button>
        </form>

        <div className="auth-footer">
          <AppLink to="/login">← Back to sign in</AppLink>
        </div>
      </div>
    </AuthShell>
  );
}
