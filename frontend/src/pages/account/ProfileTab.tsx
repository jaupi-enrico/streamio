/** Profile settings: display name, avatar, password and the danger zone. */
import { useEffect, useState, type JSX } from "react";
import { api } from "../../lib/auth";
import type { AccountUser } from "./types";

type Toast = (msg: string, type?: "success" | "error") => void;

interface Props {
  user: AccountUser;
  onUserChanged: (u: AccountUser) => void;
  toast: Toast;
  onDeleteAccount: () => void;
}

export function ProfileTab({ user, onUserChanged, toast, onDeleteAccount }: Props): JSX.Element {
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || "");
  const [saving, setSaving] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [currentPw, setCurrentPw] = useState("");

  // The form is pre-filled from the account, and re-filled when a save
  // returns a changed one.
  useEffect(() => {
    setDisplayName(user.display_name || "");
    setAvatarUrl(user.avatar_url || "");
  }, [user]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const updated = await api<AccountUser>("/api/account/me", {
        method: "PATCH",
        body: {
          display_name: displayName.trim() || undefined,
          avatar_url: avatarUrl.trim() || undefined,
        },
      });
      onUserChanged(updated);
      toast("Profile saved!");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  function changePassword(): void {
    if (!newPw || !confirmPw) return toast("Fill in new password fields.", "error");
    if (newPw !== confirmPw) return toast("Passwords do not match.", "error");
    if (newPw.length < 8) return toast("Password must be at least 8 characters.", "error");
    // Password change would go via a dedicated endpoint not in this scope
    toast("Password change not yet wired to an endpoint.", "error");
  }

  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Profile Settings</div>
          <div className="section-sub">Manage your display name and avatar</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Display Information</div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Display Name</label>
            <input
              className="field-input"
              type="text"
              id="displayName"
              placeholder="How you appear to others"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">Email</label>
            <input
              className="field-input"
              type="email"
              id="emailField"
              placeholder="your@email.com"
              disabled
              style={{ opacity: 0.5, cursor: "not-allowed" }}
              value={user.email}
              readOnly
            />
            <span className="field-hint">Email cannot be changed here.</span>
          </div>
          <div className="field" style={{ gridColumn: "1/-1" }}>
            <label className="field-label">Avatar URL</label>
            <input
              className="field-input"
              type="url"
              id="avatarUrl"
              placeholder="https://example.com/avatar.jpg"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
            />
            <span className="field-hint">Paste a direct link to an image (JPG, PNG, WebP).</span>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" id="saveProfileBtn" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button
            className="btn btn-ghost"
            id="cancelProfileBtn"
            onClick={() => {
              setDisplayName(user.display_name || "");
              setAvatarUrl(user.avatar_url || "");
            }}
          >
            Discard
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Password &amp; Security</div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Current Password</label>
            <input
              className="field-input"
              type="password"
              id="currentPw"
              placeholder="••••••••"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
            />
          </div>
          <div style={{ display: "none" }} id="pwSpacer" />
          <div className="field">
            <label className="field-label">New Password</label>
            <input
              className="field-input"
              type="password"
              id="newPw"
              placeholder="Min. 8 characters"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">Confirm Password</label>
            <input
              className="field-input"
              type="password"
              id="confirmPw"
              placeholder="Repeat new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" id="changePwBtn" onClick={changePassword}>
            Update Password
          </button>
        </div>
      </div>

      <div className="danger-card">
        <div className="danger-title">Danger Zone</div>
        <div className="danger-desc">
          Permanently delete your account and all associated data. This cannot be undone.
        </div>
        <button className="btn btn-danger" id="deleteAccountBtn" onClick={onDeleteAccount}>
          Delete Account
        </button>
      </div>
    </>
  );
}
