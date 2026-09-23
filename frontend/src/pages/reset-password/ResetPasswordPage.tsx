/**
 * Password reset, the confirm half — a port of public/reset-password.html +
 * scripts/reset-password.js. Requesting the email lives on the login page.
 * Without a `?token=` the page asks for the code printed in the email, which
 * works from whatever URL the install currently has.
 */
import { useEffect, useRef, useState, type FormEvent, type JSX, type Ref } from "react";
import { AppLink } from "../../components/layout/AppLink";
import { Spinner } from "../../components/ui/Spinner";
import { apiUrl } from "../../lib/base";
import { AuthShell, StatusBadge, normalizeCode, useRedirectToLogin } from "../auth-pages/AuthShell";

const LABELS = ["", "Weak", "Good", "Strong"] as const;

/**
 * Advisory only. The server's rule is length >= 8 and nothing else, so this
 * never blocks a submit.
 */
export function scorePassword(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let points = 0;
  if (pw.length >= 8) points++;
  if (pw.length >= 12) points++;
  if (/\d/.test(pw)) points++;
  if (/[a-zA-Z]/.test(pw)) points++;
  if (/[^\w\s]/.test(pw)) points++;
  if (pw.length < 8) return 1; // below the server's minimum, never anything but weak
  if (points <= 2) return 1;
  if (points === 3) return 2;
  return 3;
}

function EyeIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
  inputRef?: Ref<HTMLInputElement>;
}

function PasswordField({ id, label, placeholder, value, onChange, minLength, inputRef }: PasswordFieldProps): JSX.Element {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="pw-wrap">
        <input
          ref={inputRef}
          className="field-input"
          id={id}
          type={shown ? "text" : "password"}
          placeholder={placeholder}
          minLength={minLength}
          required
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          className="pw-toggle"
          type="button"
          data-toggle={id}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          <EyeIcon />
        </button>
      </div>
    </div>
  );
}

export default function ResetPasswordPage(): JSX.Element {
  const [urlToken] = useState(() => new URLSearchParams(location.search).get("token"));
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const tokenRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const redirectNote = useRedirectToLogin(done);

  useEffect(() => {
    (urlToken ? passwordRef : tokenRef).current?.focus();
  }, [urlToken]);

  const score = scorePassword(password);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = urlToken ?? normalizeCode(code);
    if (!token) return setError("Paste the reset code from your email.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");

    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/auth/password-reset/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (res.ok) setDone(true);
      else setError(data.error ?? data.message ?? "Could not reset your password.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Reset Password - Streamio">
      <div className={`panel${done ? "" : " active"}`} id="panelForm">
        <h1 className="auth-heading">Reset password</h1>
        <p className="auth-sub">Choose a new password for your account.</p>

        <div className={`error-msg${error ? " show" : ""}`} id="formError">
          {error}
        </div>

        <form id="form" onSubmit={onSubmit}>
          <div className="field" id="tokenRow" hidden={Boolean(urlToken)}>
            <label className="field-label" htmlFor="token">
              Reset code
            </label>
            <input
              ref={tokenRef}
              className="field-input code-input"
              id="token"
              type="text"
              placeholder="Paste the code from your email"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          <PasswordField
            id="password"
            label="New password"
            placeholder="Min. 8 characters"
            minLength={8}
            value={password}
            onChange={setPassword}
            inputRef={passwordRef}
          />

          <div className="pw-meter" id="pwMeter" data-score={String(score)}>
            <div className="pw-meter-bars">
              <span />
              <span />
              <span />
            </div>
            <span className="pw-meter-label" id="pwMeterLabel">
              {LABELS[score]}
            </span>
          </div>

          <PasswordField
            id="confirm"
            label="Confirm password"
            placeholder="Repeat your new password"
            value={confirm}
            onChange={setConfirm}
          />

          <button className="btn-submit" type="submit" id="submitBtn" disabled={busy}>
            {busy ? <Spinner /> : "Reset password"}
          </button>
        </form>

        <div className="auth-footer">
          <AppLink to="/login">← Back to sign in</AppLink>
        </div>
      </div>

      <div className={`panel panel-centered${done ? " active" : ""}`} id="panelSuccess">
        <StatusBadge />
        <h1 className="auth-heading">Password updated</h1>
        <p className="auth-sub">You can sign in with your new password now.</p>
        <AppLink className="btn-submit" to="/login">
          Go to sign in
        </AppLink>
        <p className="redirect-note" id="redirectNote">
          {redirectNote}
        </p>
      </div>
    </AuthShell>
  );
}
