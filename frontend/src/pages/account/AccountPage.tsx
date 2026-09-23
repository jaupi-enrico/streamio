/**
 * The account page — a port of public/account.html + scripts/account.js.
 *
 * One tab per concern (library, stats, profile, preferences, social and the
 * admin-only server settings); each tab's own file owns its data. This file is
 * the shell: the session, the hero, the tab bar and the page-level modals.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useLocation, useNavigate } from "react-router";
import { NotifBadge } from "../../components/layout/NotifBadge";
import { TopNav } from "../../components/layout/TopNav";
import { useStatusToast } from "../../components/ui/Toast";
import { useAdminAccess } from "../../hooks/useAdminAccess";
import { usePageScope } from "../../hooks/usePageScope";
import { useShareBadge } from "../../hooks/useShareBadge";
import { api, ApiError, loginHref, logout } from "../../lib/auth";
import { appPageHref } from "../../lib/base";
import { pageHref } from "../../lib/pages";
import { AdminTab } from "./AdminTab";
import { memberSince } from "./format";
import { LibraryGrid, HistoryTab, listCount, useListSnapshot } from "./LibraryTabs";
import { LibraryList } from "./library-store";
import { Modal } from "./Modal";
import { PreferencesTab, savePreference } from "./PreferencesTab";
import { ProfileTab } from "./ProfileTab";
import { SocialTab } from "./SocialTab";
import { StatsTab } from "./StatsTab";
import {
  TabBookmark,
  TabClockHistory,
  TabGear,
  TabHdd,
  TabHeart,
  TabPeople,
  TabPerson,
  TabTrophy,
} from "./tab-icons";
import type { AccountUser } from "./types";
import "../account/account.css";

type Tab = "watchlist" | "favorites" | "history" | "stats" | "profile" | "preferences" | "social" | "admin";

const TABS: Tab[] = ["watchlist", "favorites", "history", "stats", "profile", "preferences", "social", "admin"];

export default function AccountPage(): JSX.Element {
  usePageScope("account", "Account - Streamio", "italic");

  const navigate = useNavigate();
  const location = useLocation();
  const { toast, show } = useStatusToast();
  const unread = useShareBadge();

  const [user, setUser] = useState<AccountUser | null>(null);

  // The three paginated listings outlive every render and every tab switch —
  // see library-store.ts.
  const lists = useMemo(
    () => ({
      wl: new LibraryList("/api/account/watchlist"),
      fv: new LibraryList("/api/account/favorites"),
      hist: new LibraryList("/api/account/history"),
    }),
    [],
  );
  const wlSnap = useListSnapshot(lists.wl);
  const fvSnap = useListSnapshot(lists.fv);

  // A hash picks the tab, so /account#history from elsewhere lands on it.
  const hashTab = location.hash.replace(/^#/, "") as Tab;
  const [tab, setTab] = useState<Tab>(TABS.includes(hashTab) ? hashTab : "watchlist");
  useEffect(() => {
    if (TABS.includes(hashTab) && hashTab !== tab) setTab(hashTab);
    // Only a hash change may move the tab; a click sets both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashTab]);

  const [statsToken, setStatsToken] = useState(0);
  const [badgeCount, setBadgeCount] = useState(0);
  const [prefsReload, setPrefsReload] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [prefDraft, setPrefDraft] = useState<{ key: string; value: string; editing: boolean } | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);

  const admin = useAdminAccess(user !== null);
  const isAdmin = admin.data === "yes";

  // ── Session ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await api<AccountUser>("/api/account/me");
        if (cancelled) return;
        setUser(me);
        // Favorites and the watchlist start loading immediately, as they do on
        // the vanilla page — the watchlist tab is the one that opens.
        void lists.fv.load(true);
        void lists.wl.load(true);
      } catch {
        if (!cancelled) window.location.href = loginHref(appPageHref("/account"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lists]);

  /**
   * The address IS in ADMIN_EMAILS but has never been verified — common on an
   * install that upgraded into the verification requirement. Said in the
   * Preferences pane rather than a toast: an operator who can't find the admin
   * panel needs this to still be on screen when they go looking.
   */
  useEffect(() => {
    if (admin.error instanceof ApiError && admin.error.reason === "email_unverified") {
      setAdminNotice(admin.error.message);
    }
  }, [admin.error]);

  function openTab(next: Tab): void {
    setTab(next);
    navigate(`${location.pathname}#${next}`, { replace: true });
    if (next === "watchlist") lists.wl.activate();
    if (next === "favorites") lists.fv.activate();
    if (next === "history") lists.hist.activate();
    if (next === "stats") setStatsToken((t) => t + 1);
  }

  // The tab a deep link opened still needs its first page.
  const activated = useRef<Set<Tab>>(new Set());
  useEffect(() => {
    if (!user || activated.current.has(tab)) return;
    activated.current.add(tab);
    if (tab === "history") lists.hist.activate();
    if (tab === "stats") setStatsToken((t) => t + 1);
  }, [lists, tab, user]);

  async function deleteAccount(): Promise<void> {
    setDeleting(true);
    try {
      await api("/api/account/me", { method: "DELETE" });
      show("Account deleted. Redirecting…");
      setTimeout(() => {
        window.location.href = pageHref("/");
      }, 1500);
    } catch (err) {
      show((err as Error).message, "error");
      setDeleting(false);
    }
    setDeleteConfirm(null);
  }

  async function saveCustomPref(): Promise<void> {
    if (!prefDraft) return;
    const key = prefDraft.key.trim();
    const rawVal = prefDraft.value.trim();
    if (!key || rawVal === "") return show("Key and value are required.", "error");
    let value: unknown;
    try {
      value = JSON.parse(rawVal);
    } catch {
      value = rawVal;
    }
    try {
      await savePreference(key, value);
      show(`Preference "${key}" saved.`);
      setPrefDraft(null);
      setPrefsReload((t) => t + 1);
    } catch (err) {
      show((err as Error).message, "error");
    }
  }

  const resendVerification = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    await api("/api/auth/verify-email/resend", { method: "POST", body: { email: user.email } });
    return true;
  }, [user]);

  const initial = user ? (user.display_name || user.email)[0]?.toUpperCase() : "?";

  return (
    <>
      <TopNav omit={["account"]} signOut badge={false} />

      <div className="account-hero" id="accountHero">
        <div className="avatar-wrap">
          <div className="avatar" id="avatarEl">
            <Avatar url={user?.avatar_url ?? null} initial={initial ?? "?"} />
          </div>
          <div className="avatar-edit" title="Change avatar">
            ✎
          </div>
        </div>
        <div className="hero-info">
          <div className="hero-label">Your Account</div>
          <h1 className="hero-name" id="heroName">{user ? user.display_name || user.email.split("@")[0] : "Loading…"}</h1>
          <div className="hero-email" id="heroEmail">{user?.email ?? ""}</div>
          <div className="hero-badges">
            {user?.email_verified && (
              <span className="hbadge hbadge-green" id="verifiedBadge" style={{ display: "inline-block" }}>
                ✓ Verified
              </span>
            )}
            <span className="hbadge hbadge-gray" id="memberSince">{user?.created_at ? memberSince(user.created_at) : ""}</span>
          </div>
        </div>
      </div>

      <div className="tab-bar">
        <TabButton tab="watchlist" current={tab} onClick={openTab} icon={<TabBookmark />} label="Watchlist">
          <span className="tab-count" id="wlCount">{listCount(wlSnap)}</span>
        </TabButton>
        <TabButton tab="favorites" current={tab} onClick={openTab} icon={<TabHeart />} label="Favorites">
          <span className="tab-count" id="fvCount">{listCount(fvSnap)}</span>
        </TabButton>
        <TabButton tab="history" current={tab} onClick={openTab} icon={<TabClockHistory />} label="History" />
        <TabButton tab="stats" current={tab} onClick={openTab} icon={<TabTrophy />} label="Stats">
          <span className="tab-count" id="badgeCount">{badgeCount}</span>
        </TabButton>
        <TabButton tab="profile" current={tab} onClick={openTab} icon={<TabPerson />} label="Profile" />
        <TabButton tab="preferences" current={tab} onClick={openTab} icon={<TabGear />} label="Preferences" />
        <TabButton tab="social" current={tab} onClick={openTab} icon={<TabPeople />} label="Social">
          <NotifBadge count={unread} />
        </TabButton>
        {isAdmin && <TabButton tab="admin" id="adminTabBtn" current={tab} onClick={openTab} icon={<TabHdd />} label="Admin" />}
      </div>

      <div className="page-body">
        <div className="tab-panel active" id={`panel-${tab}`}>
          {tab === "watchlist" && <LibraryGrid list={lists.wl} kind="wl" toast={show} />}
          {tab === "favorites" && <LibraryGrid list={lists.fv} kind="fv" toast={show} />}
          {tab === "history" && <HistoryTab list={lists.hist} toast={show} />}
          {tab === "stats" && <StatsTab openToken={statsToken} onBadgeCount={setBadgeCount} />}
          {tab === "profile" && user && (
            <ProfileTab user={user} onUserChanged={setUser} toast={show} onDeleteAccount={() => setDeleteConfirm("")} />
          )}
          {tab === "preferences" && (
            <>
              <div className="section-head">
                <div>
                  <div className="section-title">Preferences</div>
                  <div className="section-sub">Customize your Streamio experience</div>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  id="addPrefBtn"
                  onClick={() => setPrefDraft({ key: "", value: "", editing: false })}
                >
                  + Add Custom
                </button>
              </div>
              <PreferencesTab
                toast={show}
                reloadToken={prefsReload}
                onEdit={(key, value) =>
                  setPrefDraft({ key, value: typeof value === "string" ? value : JSON.stringify(value), editing: true })
                }
                notice={
                  adminNotice ? <AdminUnverifiedNotice message={adminNotice} onResend={resendVerification} /> : null
                }
              />
            </>
          )}
          {tab === "social" && user && <SocialTab user={user} toast={show} />}
          {tab === "admin" && isAdmin && <AdminTab toast={show} />}
        </div>
      </div>

      {toast}

      <Modal id="deleteModal" open={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)}>
        {deleteConfirm !== null && (
          <>
            <div className="modal-title" style={{ color: "var(--red)" }}>
              Delete Account?
            </div>
            <div className="modal-desc">
              This will permanently delete your account, watchlist, and history. Type <strong>DELETE</strong> to confirm.
            </div>
            <div className="field">
              <input
                className="field-input"
                type="text"
                id="deleteConfirmInput"
                placeholder="Type DELETE to confirm"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" id="cancelDeleteBtn" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                id="confirmDeleteBtn"
                disabled={deleteConfirm !== "DELETE" || deleting}
                onClick={() => void deleteAccount()}
              >
                {deleting ? "Deleting…" : "Delete Forever"}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal id="prefModal" open={Boolean(prefDraft)} onClose={() => setPrefDraft(null)}>
        {prefDraft && (
          <>
            <div className="modal-title" id="prefModalTitle">{prefDraft.editing ? "Edit Preference" : "Add Preference"}</div>
            <div className="modal-desc">Preferences are stored as key-value pairs.</div>
            <div className="form-grid full" style={{ gap: 12 }}>
              <div className="field">
                <label className="field-label">Key</label>
                <input
                  className="field-input"
                  type="text"
                  id="prefKeyInput"
                  placeholder="e.g. autoplay"
                  disabled={prefDraft.editing}
                  value={prefDraft.key}
                  onChange={(e) => setPrefDraft({ ...prefDraft, key: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label">Value</label>
                <input
                  className="field-input"
                  type="text"
                  id="prefValInput"
                  placeholder='e.g. true or "en"'
                  value={prefDraft.value}
                  onChange={(e) => setPrefDraft({ ...prefDraft, value: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" id="cancelPrefBtn" onClick={() => setPrefDraft(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" id="savePrefBtn" onClick={() => void saveCustomPref()}>
                Save
              </button>
            </div>
          </>
        )}
      </Modal>

      <AccountBottomNav />
    </>
  );
}

function TabButton({
  tab,
  id,
  current,
  onClick,
  icon,
  label,
  children,
}: {
  tab: Tab;
  id?: string;
  current: Tab;
  onClick: (t: Tab) => void;
  icon: JSX.Element;
  label: string;
  children?: JSX.Element | null;
}): JSX.Element {
  return (
    <button id={id} className={`tab-btn${tab === current ? " active" : ""}`} data-tab={tab} onClick={() => onClick(tab)}>
      <span>{icon}</span> {label}
      {children}
    </button>
  );
}

/**
 * The hero avatar. Built as elements rather than markup because both halves
 * are user-set strings — the vanilla page's fallback used to be an inline
 * onerror handler with one of them interpolated into it.
 */
function Avatar({ url, initial }: { url: string | null; initial: string }): JSX.Element {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!url || broken) return <span id="avatarInitial">{initial}</span>;
  return <img src={url} alt="avatar" onError={() => setBroken(true)} />;
}

function AdminUnverifiedNotice({
  message,
  onResend,
}: {
  message: string;
  onResend: () => Promise<boolean>;
}): JSX.Element {
  const [help, setHelp] = useState("");
  const [sending, setSending] = useState(false);
  return (
    <div
      className="pref-card"
      id="adminUnverifiedNotice"
      style={{ border: "1px solid rgba(229,9,20,.45)", marginBottom: 14, padding: 14, borderRadius: 8 }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#fff" }}>
        Admin access is waiting on email verification
      </div>
      <div style={{ fontSize: "0.85rem", color: "var(--muted2)", lineHeight: 1.55 }}>
        {message || "Verify your email address to enable admin access."}
      </div>
      <button
        className="btn btn-secondary btn-sm"
        disabled={sending}
        onClick={async () => {
          setSending(true);
          try {
            await onResend();
            setHelp("Sent. Check your inbox, then reload this page.");
          } catch {
            setHelp("Could not send it. Try again in a moment.");
          }
        }}
      >
        Send me a new verification link
      </button>
      <div style={{ fontSize: "0.85rem", color: "var(--muted2)", lineHeight: 1.55, marginTop: 8 }}>{help}</div>
    </div>
  );
}

/**
 * The mobile bottom nav. This tab is already active — we're on the account
 * page — so it substitutes itself for a Logout button right away, as the
 * vanilla page does.
 */
function AccountBottomNav(): JSX.Element {
  return (
    <div className="bottom-nav" aria-label="Mobile navigation" role="navigation">
      <a href={pageHref("/")} className="bottom-nav-item">
        <svg viewBox="0 0 24 24">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        Home
      </a>
      <a href={pageHref("/catalog")} className="bottom-nav-item">
        <svg viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
        Catalog
      </a>
      <a href={pageHref("/search")} className="bottom-nav-item">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search
      </a>
      <a href={pageHref("/providers")} className="bottom-nav-item">
        <svg viewBox="0 0 24 24">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        Providers
      </a>
      <button type="button" id="bottomNavAccount" className="bottom-nav-item active is-logout" onClick={() => void logout()}>
        <svg className="icon-logout" viewBox="0 0 24 24">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span id="bottomNavAccountLabel">Logout</span>
      </button>
    </div>
  );
}
