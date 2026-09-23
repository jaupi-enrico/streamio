/**
 * Sign in / create account / reset password — a port of public/login.html +
 * scripts/login.js. Also served at /auth/callback, where the OAuth round trip
 * lands with a single-use `code` (or, from older builds, a `token`).
 *
 * Same element ids, classes and requests as the vanilla page, so the two can
 * be compared in devtools.
 */
import { useEffect, useState, type FormEvent, type JSX } from "react";
import { AppLink } from "../../components/layout/AppLink";
import { Spinner } from "../../components/ui/Spinner";
import { usePageScope } from "../../hooks/usePageScope";
import { saveAccessToken } from "../../lib/auth";
import { apiUrl } from "../../lib/base";
import { pageHref } from "../../lib/pages";
import "./login.css";

type Mode = "login" | "register" | "reset";

/**
 * `?redirect=` is handed to `window.location`, which makes it a navigation
 * sink: `javascript:` would run script on this origin (holding a fresh
 * session) and `//evil.example` or `/\evil.example` would walk the user off
 * the site. So it is resolved against our own origin and only its path is
 * used; anything that lands elsewhere falls back to the home page. Mirrors
 * `isAllowedRedirect` in routes/auth.router.ts.
 */
function safeRedirect(raw: string | null): string {
  const home = pageHref("/");
  if (typeof raw !== "string" || raw === "") return home;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return home;
  }
  if (url.origin !== window.location.origin) return home;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * /api/version/download needs a signed-in user but a plain navigation can't
 * carry the Authorization header, so it takes `?token=`. Only ever added for
 * that one destination — never leak the token onto an arbitrary redirect.
 */
function withDownloadToken(redirect: string, accessToken: string): string {
  if (redirect !== "/api/version/download" && redirect !== apiUrl("/api/version/download")) return redirect;
  return `${redirect}?token=${encodeURIComponent(accessToken)}`;
}

/**
 * The handoff code is single-use; StrictMode runs effects twice in
 * development, and a second exchange would fail and print an error over a
 * sign-in that worked. Module state, so it outlives a remount.
 */
let exchangeStarted = false;

const HEADINGS: Record<Mode, { heading: string; sub: string }> = {
  login: { heading: "Welcome back", sub: "Sign in to continue watching." },
  register: { heading: "Create account", sub: "Join Streamio to save your shows and history." },
  reset: { heading: "Reset password", sub: "We'll email you a link to reset your password." },
};

export default function LoginPage(): JSX.Element {
  usePageScope("login", "Sign In - Streamio");

  // Captured once per visit, before the code exchange strips them from the
  // address bar.
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const [mode, setMode] = useState<Mode>("login");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "busy" | "sent">("idle");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");

  function leave(accessToken: string) {
    saveAccessToken(accessToken);
    const redirect = safeRedirect(initialParams.get("redirect"));
    window.location.replace(withDownloadToken(redirect, accessToken));
  }

  // OAuth callback. The callback runs on the APP_URL origin, which can differ
  // from the one the browser ends up on behind a proxy, and a server can only
  // set a cookie for the host it was contacted on — so it hands over a
  // single-use code and *we* trade it for a session here, which puts the
  // refresh cookie on the host actually being browsed. `?token=` is still
  // honoured for links from the previous build.
  useEffect(() => {
    const code = initialParams.get("code");
    const token = initialParams.get("token");

    if (code) {
      if (exchangeStarted) return;
      exchangeStarted = true;
      // Drop the code from the address bar before anything awaits on it, so
      // it can't be re-shared or land in a later referrer.
      history.replaceState(null, "", window.location.pathname);
      void (async () => {
        try {
          const res = await fetch(apiUrl("/api/auth/oauth/exchange"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ code }),
          });
          const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
          if (res.ok && data.access_token) {
            leave(data.access_token);
            return;
          }
          // A bare login form would look like "your click did nothing".
          setLoginError(data.error || "Accesso non riuscito. Riprova.");
        } catch {
          setLoginError("Impossibile contattare il server. Riprova.");
        }
      })();
      return;
    }

    if (token) leave(token);
    // Once per visit, on the params captured at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The OAuth links carry the page's own `redirect`, which the server
  // reflects into a Location header after the round trip — so it goes through
  // the same filter as the navigations above.
  const oauthRedirect = safeRedirect(initialParams.get("redirect"));
  function oauthHref(provider: "google" | "discord"): string {
    const base = apiUrl(`/api/auth/${provider}`);
    if (oauthRedirect === "/") return base;
    return `${base}?redirect=${encodeURIComponent(oauthRedirect)}`;
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = (await res.json()) as { access_token?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Login failed.");
      saveAccessToken(data.access_token);
      const redirect = safeRedirect(initialParams.get("redirect"));
      window.location.href = withDownloadToken(redirect, data.access_token ?? "");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
      setLoginBusy(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegisterError(null);
    if (regPassword.length < 8) {
      setRegisterError("Password must be at least 8 characters.");
      return;
    }
    setRegisterBusy(true);
    try {
      const res = await fetch(apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: regEmail,
          password: regPassword,
          display_name: regName.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { access_token?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Registration failed.");
      saveAccessToken(data.access_token);
      window.location.href = pageHref("/account");
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : String(err));
      setRegisterBusy(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetState("busy");
    try {
      // The answer is the same whether or not the address has an account,
      // so there is nothing in it to show.
      await fetch(apiUrl("/api/auth/password-reset/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail }),
      });
      setResetState("sent");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err));
      setResetState("idle");
    }
  }

  const isReset = mode === "reset";
  const { heading, sub } = HEADINGS[mode];

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
        <div className="auth-card">
          <h1 className="auth-heading" id="authHeading">
            {heading}
          </h1>
          <p className="auth-sub" id="authSub">
            {sub}
          </p>

          <div className="mode-tabs" id="modeTabs" style={{ display: isReset ? "none" : "flex" }}>
            <button
              type="button"
              className={`mode-tab${mode === "login" ? " active" : ""}`}
              data-mode="login"
              onClick={() => setMode("login")}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`mode-tab${mode === "register" ? " active" : ""}`}
              data-mode="register"
              onClick={() => setMode("register")}
            >
              Create Account
            </button>
          </div>

          <div className="oauth-group" id="oauthGroup" style={{ display: isReset ? "none" : "flex" }}>
            <a href={oauthHref("google")} className="oauth-btn">
              <span className="oauth-icon">
                <img src={`${import.meta.env.BASE_URL}icons/google.svg`} alt="Google" />
              </span>{" "}
              Continue with Google
            </a>
            <a href={oauthHref("discord")} className="oauth-btn">
              <span className="oauth-icon">
                <img src={`${import.meta.env.BASE_URL}icons/discord.svg`} alt="Discord" />
              </span>{" "}
              Continue with Discord
            </a>
          </div>

          <div className="divider" id="dividerEl" style={{ display: isReset ? "none" : "flex" }}>
            or continue with email
          </div>

          <form id="loginForm" style={{ display: mode === "login" ? "block" : "none" }} onSubmit={handleLogin}>
            <div className={`error-msg${loginError ? " show" : ""}`} id="loginError">
              {loginError}
            </div>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                id="loginEmail"
                type="email"
                placeholder="your@email.com"
                required
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                id="loginPassword"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </div>
            <div className="forgot">
              <a
                href="#"
                id="forgotLink"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("reset");
                }}
              >
                Forgot password?
              </a>
            </div>
            <button className="btn-submit" type="submit" id="loginSubmit" disabled={loginBusy}>
              {loginBusy ? <Spinner /> : "Sign In"}
            </button>
          </form>

          <form id="registerForm" style={{ display: mode === "register" ? "block" : "none" }} onSubmit={handleRegister}>
            <div className={`error-msg${registerError ? " show" : ""}`} id="registerError">
              {registerError}
            </div>
            <div className="field">
              <label className="field-label">Display Name</label>
              <input
                className="field-input"
                id="regName"
                type="text"
                placeholder="How you'll appear"
                autoComplete="name"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                id="regEmail"
                type="email"
                placeholder="your@email.com"
                required
                autoComplete="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <input
                className="field-input"
                id="regPassword"
                type="password"
                placeholder="Min. 8 characters"
                required
                autoComplete="new-password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
              />
            </div>
            <button className="btn-submit" type="submit" id="registerSubmit" disabled={registerBusy}>
              {registerBusy ? <Spinner /> : "Create Account"}
            </button>
          </form>

          <form id="resetForm" style={{ display: isReset ? "block" : "none" }} onSubmit={handleReset}>
            <div className={`error-msg${resetError ? " show" : ""}`} id="resetError">
              {resetError}
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 16 }}>
              Enter your email and we'll send a reset link.
            </p>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="field-input"
                id="resetEmail"
                type="email"
                placeholder="your@email.com"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
              />
            </div>
            <button
              className="btn-submit"
              type="submit"
              id="resetSubmit"
              disabled={resetState === "busy"}
              style={resetState === "sent" ? { background: "#1a6e33" } : undefined}
            >
              {resetState === "busy" ? <Spinner /> : resetState === "sent" ? "✓ Check your inbox" : "Send Reset Link"}
            </button>
            <p style={{ textAlign: "center", marginTop: 16, fontSize: "0.83rem" }}>
              <BackToLogin onClick={() => setMode("login")} />
            </p>
          </form>

          <div className="auth-footer" id="authFooter" style={{ display: isReset ? "none" : "block" }}>
            {mode === "register" ? (
              <>
                Already have an account?{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setMode("login");
                  }}
                >
                  Sign in
                </a>
              </>
            ) : (
              <>
                Don't have an account?{" "}
                <a
                  href="#"
                  id="switchToRegister"
                  onClick={(e) => {
                    e.preventDefault();
                    setMode("register");
                  }}
                >
                  Sign up for free
                </a>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/** "← Back to sign in", with the vanilla page's inline hover colour. */
function BackToLogin({ onClick }: { onClick: () => void }): JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <a
      href="#"
      id="backToLogin"
      style={{ color: hover ? "white" : "var(--muted)", textDecoration: "none" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      ← Back to sign in
    </a>
  );
}
