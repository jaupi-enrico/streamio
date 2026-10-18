/**
 * Server settings — the admin-only tab: build info, updates, the app version
 * policy, cross-server sync, hosting points and power.
 *
 * Nothing here is reachable without an admin probe having answered "yes"
 * (useAdminAccess); the server gates every one of these endpoints regardless.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { IconAlert, IconCheckCircle, IconGlobe, IconLoader, IconXCircle } from "../../components/icons/icons";
import { api, apiFetch } from "../../lib/auth";
import { pageHref } from "../../lib/pages";
import { relativeDate } from "./format";
import { Modal } from "./Modal";
import type {
  ClientVersionSettings,
  HostingPoint,
  PowerStatus,
  UpdateHistoryRow,
  UpdateStatus,
  VersionInfo,
} from "./types";

type Toast = (msg: string, type?: "success" | "error") => void;

const UPDATE_HISTORY_VISIBLE = 3;

export function AdminTab({ toast }: { toast: Toast }): JSX.Element {
  return (
    <>
      <div className="section-head">
        <div>
          <div className="section-title">Server Settings</div>
          <div className="section-sub">
            Sync this server&apos;s library data with other Streamio hosting points
          </div>
        </div>
      </div>
      <VersionCard />
      <ProvidersCard />
      <UpdatesCard toast={toast} />
      <ClientVersionCard toast={toast} />
      <SyncCard toast={toast} />
      <HostingPointsCard toast={toast} />
      <PowerCard toast={toast} />
    </>
  );
}

// ── Version ──

function VersionCard(): JSX.Element {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        setInfo(await api<VersionInfo>("/api/version"));
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  return (
    <div className="card">
      <div className="card-title">Version</div>
      <div className="section-sub" style={{ marginBottom: 12 }}>
        The exact build this server is running.
      </div>
      <div id="versionInfoContent">
        {failed ? (
          <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Failed to load version info.</div>
        ) : !info ? (
          <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Loading version…</div>
        ) : (
          <div className="pref-grid">
            <div className="pref-row">
              <div className="pref-info">
                <div className="pref-key">Streamio {info.server.version}</div>
                <div className="pref-desc">
                  build {info.server.commit} · built{" "}
                  {info.server.builtAt ? new Date(info.server.builtAt).toLocaleString() : "unknown"} · API v
                  {info.api.version}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProvidersCard(): JSX.Element {
  return (
    <div className="card">
      <div className="card-title">Providers</div>
      <div className="section-sub" style={{ marginBottom: 12 }}>
        Enable/disable individual content sources and clear their cached responses.
      </div>
      <div className="form-actions">
        <a className="btn btn-secondary btn-sm" href={pageHref("/admin/providers")}>
          Manage Providers
        </a>
        <a className="btn btn-secondary btn-sm" href={pageHref("/admin/local-provider")}>
          My Library
        </a>
      </div>
    </div>
  );
}

// ── Updates ──

function UpdatesCard({ toast }: { toast: Toast }): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [autoApply, setAutoApply] = useState(false);
  const [repo, setRepo] = useState("");
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [historyToken, setHistoryToken] = useState(0);

  const load = useCallback(async (force = false) => {
    try {
      const s = force
        ? await api<UpdateStatus>("/api/settings/update/check", { method: "POST" })
        : await api<UpdateStatus>("/api/settings/update");
      setStatus(s);
      setEnabled(!!s.enabled);
      setAutoApply(!!s.autoApply);
      setRepo(s.repo || "");
      setFailed(false);
      return s;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    try {
      await api("/api/settings/update", {
        method: "PUT",
        body: { enabled, auto_apply: autoApply, repo: repo.trim() },
      });
      toast("Update settings saved.");
      void load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function check(): Promise<void> {
    setChecking(true);
    try {
      const s = await load(true);
      toast(s?.updateAvailable ? "An update is available." : "Already up to date.");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setChecking(false);
    }
  }

  async function install(): Promise<void> {
    setInstalling(true);
    try {
      await api("/api/settings/update/apply", { method: "POST" });
      toast("Update requested.");
      setConfirming(false);
      void load();
      setHistoryToken((t) => t + 1);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setInstalling(false);
    }
  }

  async function cancelPending(): Promise<void> {
    try {
      await api("/api/settings/update/cancel", { method: "POST" });
      toast("Pending update cancelled.");
      void load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="card">
      <div className="card-title">Updates</div>
      <div className="section-sub" style={{ marginBottom: 12 }}>
        Installs new releases published to the configured GitHub repository. The server can&apos;t rebuild itself — the
        host-side <strong>updater</strong> process does the work, so it must be running for an install to actually
        happen.
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="field-label">Status</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" id="updateEnabledToggle" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span id="updateEnabledLabel" style={{ fontSize: "0.9rem" }}>{enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        <div className="field">
          <label className="field-label">Repository (owner/name)</label>
          <input
            className="field-input"
            type="text"
            id="updateRepoInput"
            placeholder="streamio-org/streamio-website"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">Install automatically</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" id="updateAutoApplyToggle" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
            <span id="updateAutoApplyLabel" style={{ fontSize: "0.9rem" }}>
              {autoApply ? "On — install without asking" : "Off — ask first"}
            </span>
          </label>
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" id="saveUpdateSettingsBtn" onClick={() => void save()}>
          Save
        </button>
      </div>

      <div id="updateStatusBox" style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "var(--card2,rgba(255,255,255,0.03))" }}>
        <div id="updateStatusDesc" style={{ fontSize: "0.9rem" }}>
          {failed ? "Failed to load update status." : !status ? "Loading update status…" : <UpdateStatusText s={status} />}
        </div>
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" id="checkUpdateBtn" disabled={checking} onClick={() => void check()}>
            {checking ? "Checking…" : "Check for Updates"}
          </button>
          {status && status.enabled && !status.lastCheckError && !status.shouldUpdate && status.updateAvailable && (
            <button className="btn btn-primary btn-sm" id="installUpdateBtn" onClick={() => setConfirming(true)}>
              Install Update
            </button>
          )}
          {status && status.enabled && !status.lastCheckError && status.shouldUpdate && (
            <button className="btn btn-ghost btn-sm" id="cancelUpdateBtn" onClick={() => void cancelPending()}>
              Cancel Pending Update
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="field-label" style={{ marginBottom: 8 }}>
          Recent updates
        </div>
        <UpdateHistory token={historyToken} />
      </div>

      <Modal id="updateModal" open={Boolean(confirming && status?.latest)} onClose={() => setConfirming(false)}>
        {confirming && status?.latest && (
          <>
            <div className="modal-title">Install Update?</div>
            <div className="modal-desc" id="updateModalDesc">
              This installs <strong>{status.latest.version}</strong>, replacing {status.currentVersion}.
            </div>
            <div className="modal-desc" style={{ marginTop: 8 }}>
              The new version is built before anything stops, so the server keeps running during the slow part. It will
              then restart — anyone watching right now will be interrupted for a moment.
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" id="cancelUpdateModalBtn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" id="confirmUpdateBtn" disabled={installing} onClick={() => void install()}>
                {installing ? "Requesting…" : "Install Now"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function UpdateStatusText({ s }: { s: UpdateStatus }): JSX.Element {
  if (!s.enabled)
    return (
      <>
        Update checking is off. Running <strong>{s.currentVersion}</strong>.
      </>
    );
  if (s.lastCheckError)
    // Most often a private repo with no token, or no published release yet —
    // both look like "nothing available", so say what actually went wrong.
    return (
      <>
        <span style={{ color: "var(--red)" }}>Couldn&apos;t check for updates: {s.lastCheckError}</span>
        <br />
        Running <strong>{s.currentVersion}</strong>.
      </>
    );
  if (s.shouldUpdate)
    return (
      <>
        <strong>Update pending.</strong> {s.latest?.version} will be installed by the host updater shortly
        {s.requestedBy ? ` (requested by ${s.requestedBy})` : ""}.
      </>
    );
  if (s.updateAvailable)
    return (
      <>
        <strong>{s.latest?.version} is available.</strong> You&apos;re running {s.currentVersion}.{" "}
        {s.latest?.url ? (
          <a href={s.latest.url} target="_blank" rel="noopener">
            Release notes ↗
          </a>
        ) : null}
      </>
    );
  return (
    <>
      Up to date — running <strong>{s.currentVersion}</strong>
      {s.latest ? `, latest release is ${s.latest.version}` : ""}.
    </>
  );
}

function UpdateHistory({ token }: { token: number }): JSX.Element {
  const [rows, setRows] = useState<UpdateHistoryRow[] | "error" | null>(null);
  const [showOlder, setShowOlder] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setRows(await api<UpdateHistoryRow[]>("/api/settings/update/history"));
      } catch {
        setRows("error");
      }
    })();
  }, [token]);

  if (rows === null)
    return (
      <div id="updateHistoryContent">
        <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Loading…</div>
      </div>
    );
  if (rows === "error")
    return (
      <div id="updateHistoryContent">
        <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Failed to load update history.</div>
      </div>
    );
  if (!rows.length)
    return (
      <div id="updateHistoryContent">
        <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>No updates installed yet.</div>
      </div>
    );

  const recent = rows.slice(0, UPDATE_HISTORY_VISIBLE);
  const older = rows.slice(UPDATE_HISTORY_VISIBLE);
  return (
    <div id="updateHistoryContent">
      <div className="pref-grid">{recent.map(historyRow)}</div>
      {older.length > 0 && (
        <>
          <div className="pref-grid" id="updateHistoryOlder" style={{ marginTop: 4 }} hidden={!showOlder}>
            {older.map(historyRow)}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            id="updateHistoryToggle"
            style={{ marginTop: 8 }}
            onClick={() => setShowOlder((v) => !v)}
          >
            {showOlder ? "Show less" : `Show ${older.length} older`}
          </button>
        </>
      )}
    </div>
  );
}

function historyRow(r: UpdateHistoryRow, i: number): JSX.Element {
  const icon =
    r.status === "ok" ? (
      <span className="update-status-icon ok">
        <IconCheckCircle />
      </span>
    ) : r.status === "error" ? (
      <span className="update-status-icon error">
        <IconXCircle />
      </span>
    ) : r.status === "started" ? (
      <span className="update-status-icon started">
        <IconLoader />
      </span>
    ) : null;
  return (
    <div className="pref-row" key={`${r.started_at}-${i}`}>
      <div className="pref-info">
        <div className="pref-key">
          {icon} {r.from_version} → {r.to_version}
        </div>
        <div className="pref-desc">
          {r.trigger}
          {r.requested_by ? ` by ${r.requested_by}` : ""} · {relativeDate(r.started_at)}
          {r.status === "error" && r.error ? ` · ${r.error}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── App version policy ──

function ClientVersionCard({ toast }: { toast: Toast }): JSX.Element {
  const [latest, setLatest] = useState("");
  const [minSupported, setMinSupported] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [enforce, setEnforce] = useState(false);
  const [apk, setApk] = useState<ClientVersionSettings | null>(null);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api<ClientVersionSettings>("/api/settings/client-version");
        setLatest(s.latest || "");
        setMinSupported(s.minSupported || "");
        setDownloadUrl(s.downloadUrl || "");
        setNotes(s.notes || "");
        setEnforce(!!s.enforce);
        setApk(s);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    })();
  }, [toast]);

  async function save(): Promise<void> {
    // Blocking people without telling them where to get the new build is a
    // dead end for the user, so refuse that combination up front.
    if (enforce && !minSupported.trim())
      return toast("Set a minimum supported version before blocking outdated apps.", "error");
    if (enforce && !downloadUrl.trim()) return toast("Set a download URL before blocking outdated apps.", "error");
    try {
      await api("/api/settings/client-version", {
        method: "PUT",
        body: {
          latest: latest.trim(),
          min_supported: minSupported.trim(),
          download_url: downloadUrl.trim(),
          notes: notes.trim(),
          enforce,
        },
      });
      toast("App version policy saved.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function upload(): Promise<void> {
    if (!file) return toast("Choose a .apk file first.", "error");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("apk", file);
      const res = await apiFetch("/api/settings/client-version/apk", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as ClientVersionSettings & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDownloadUrl(data.downloadUrl || "");
      setApk(data);
      setFile(null);
      setFileKey((k) => k + 1);
      toast("APK uploaded — Download URL updated below.");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">App Version Policy</div>
      <div className="section-sub" style={{ marginBottom: 12 }}>
        What the mobile app is told when it checks in. Leave enforcement off to only <em>suggest</em> updating; turn it
        on to block app builds older than the minimum.
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="field-label">Latest app version</label>
          <input className="field-input" type="text" id="clientLatestInput" placeholder="1.0.0" value={latest} onChange={(e) => setLatest(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label">Minimum supported</label>
          <input
            className="field-input"
            type="text"
            id="clientMinInput"
            placeholder="1.0.0"
            value={minSupported}
            onChange={(e) => setMinSupported(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">Download URL</label>
          <input
            className="field-input"
            type="text"
            id="clientDownloadInput"
            placeholder="https://…"
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label">Message (optional)</label>
          <input
            className="field-input"
            type="text"
            id="clientNotesInput"
            placeholder="What's new / why update"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="field-label">Host the build on this server</label>
        <div id="clientApkStatus" style={{ fontSize: "0.82rem", color: "var(--muted2)", marginBottom: 8 }}>
          {apkStatusText(apk)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            key={fileKey}
            id="clientApkInput"
            type="file"
            accept=".apk"
            style={{ maxWidth: 280 }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn btn-secondary btn-sm" id="uploadApkBtn" disabled={uploading} onClick={() => void upload()}>
            {uploading ? "Uploading…" : "Upload APK"}
          </button>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--muted2)", marginTop: 6 }}>
          Uploading replaces the previously hosted build and fills in Download URL above with a link to this server. Up
          to 300MB.
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label className="field-label">Block outdated apps</label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" id="clientEnforceToggle" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
          <span id="clientEnforceLabel" style={{ fontSize: "0.9rem" }}>
            {enforce ? "On — outdated apps are blocked" : "Off — only suggest updating"}
          </span>
        </label>
      </div>
      {enforce && (
        <div
          id="clientEnforceWarning"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(229,9,20,0.12)",
            color: "var(--red)",
            fontSize: "0.82rem",
          }}
        >
          Every app build below the minimum stops working immediately. Make sure the new build is actually downloadable
          first.
        </div>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" id="saveClientVersionBtn" onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * `apkUploadedAt`/`apkVersion` are informational only — set by a successful
 * upload, never edited directly. The "no longer points at it" note catches an
 * admin editing Download URL back to an external link after uploading: the
 * file stays on disk (nothing deletes it) but the server stops serving it, so
 * this is the only place that fact is visible.
 */
function apkStatusText(s: ClientVersionSettings | null): string {
  if (!s) return "Loading…";
  if (!s.apkUploadedAt) return "No build hosted on this server — Download URL points elsewhere.";
  const hosted = (s.downloadUrl || "").endsWith("/api/version/download");
  return (
    `Hosted build: v${s.apkVersion || "?"} · uploaded ${relativeDate(s.apkUploadedAt)}` +
    (hosted ? "" : " — Download URL no longer points at it.")
  );
}

// ── Sync ──

function SyncCard({ toast }: { toast: Toast }): JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [interval, setIntervalValue] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const s = await api<{ enabled: boolean; intervalMinutes: number }>("/api/settings/sync");
        setEnabled(!!s.enabled);
        setIntervalValue(String(s.intervalMinutes));
      } catch (err) {
        toast((err as Error).message, "error");
      }
    })();
  }, [toast]);

  async function save(): Promise<void> {
    const minutes = parseInt(interval, 10);
    if (!minutes || minutes < 1) return toast("Interval must be at least 1 minute.", "error");
    try {
      await api("/api/settings/sync", { method: "PUT", body: { enabled, interval_minutes: minutes } });
      toast("Sync settings saved.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="card">
      <div className="card-title">Sync</div>
      <div className="form-grid">
        <div className="field">
          <label className="field-label">Status</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" id="syncEnabledToggle" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span id="syncEnabledLabel" style={{ fontSize: "0.9rem" }}>{enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        <div className="field">
          <label className="field-label">Interval (minutes)</label>
          <input
            className="field-input"
            id="syncIntervalInput"
            type="number"
            min="1"
            step="1"
            value={interval}
            onChange={(e) => setIntervalValue(e.target.value)}
          />
        </div>
      </div>
      <div className="form-actions">
        <button className="btn btn-primary" id="saveSyncBtn" onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

// ── Hosting points ──

interface HpDraft {
  id: string | null;
  name: string;
  url: string;
  secret: string;
  enabled: boolean;
}

function HostingPointsCard({ toast }: { toast: Toast }): JSX.Element {
  const [points, setPoints] = useState<HostingPoint[] | "error" | null>(null);
  const [draft, setDraft] = useState<HpDraft | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPoints(await api<HostingPoint[]>("/api/settings/hosting-points"));
    } catch {
      setPoints("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(hp: HostingPoint): Promise<void> {
    if (!confirm(`Remove hosting point "${hp.name}"? This server will stop syncing with it.`)) return;
    try {
      await api(`/api/settings/hosting-points/${hp.id}`, { method: "DELETE" });
      toast("Hosting point removed.");
      void load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function save(): Promise<void> {
    if (!draft) return;
    const name = draft.name.trim();
    const url = draft.url.trim();
    const secret = draft.secret.trim();
    if (!name || !url) return toast("Name and URL are required.", "error");
    try {
      if (draft.id) {
        const body: Record<string, unknown> = { name, url, enabled: draft.enabled };
        if (secret) body.shared_secret = secret;
        await api(`/api/settings/hosting-points/${draft.id}`, { method: "PUT", body });
        toast("Hosting point updated.");
        setDraft(null);
        void load();
      } else {
        const body: Record<string, unknown> = { name, url };
        if (secret) body.shared_secret = secret;
        const created = await api<HostingPoint>("/api/settings/hosting-points", { method: "POST", body });
        setDraft(null);
        void load();
        if (created.shared_secret) setRevealed(created.shared_secret);
      }
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div className="card">
      <div className="card-title">Hosting Points</div>
      <div className="section-sub" style={{ marginBottom: 12 }}>
        Each hosting point must have the same shared secret configured on both this server and the peer.
      </div>
      <div id="hostingPointsContent">
        {points === null ? (
          <div className="empty">
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Loading hosting points…</div>
          </div>
        ) : points === "error" ? (
          <div className="empty">
            <div className="empty-icon">
              <IconAlert />
            </div>
            <h3>Couldn&apos;t Load</h3>
            <p>Failed to load hosting points.</p>
          </div>
        ) : !points.length ? (
          <div className="empty">
            <div className="empty-icon">
              <IconGlobe />
            </div>
            <h3>No Hosting Points</h3>
            <p>Add another Streamio server to start syncing library data.</p>
          </div>
        ) : (
          <div className="pref-grid">
            {points.map((hp) => (
              <div className="pref-row" key={hp.id}>
                <div className="pref-info">
                  <div className="pref-key">{hp.name}</div>
                  <div className="pref-desc">{hp.url}</div>
                  <div className="pref-desc">
                    {hp.enabled ? "Enabled" : "Disabled"} ·{" "}
                    {hp.last_sync_status === "error"
                      ? `last sync failed${hp.last_sync_error ? ": " + hp.last_sync_error : ""}`
                      : hp.last_synced_at
                        ? `last synced ${relativeDate(hp.last_synced_at)}`
                        : "never synced"}
                  </div>
                </div>
                <div className="pref-actions">
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    title="Edit"
                    onClick={() =>
                      setDraft({ id: hp.id, name: hp.name, url: hp.url, secret: "", enabled: hp.enabled })
                    }
                  >
                    ✎
                  </button>
                  <button className="btn btn-danger btn-sm btn-icon" title="Delete" onClick={() => void remove(hp)}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="form-actions">
        <button
          className="btn btn-secondary btn-sm"
          id="addHostingPointBtn"
          onClick={() => setDraft({ id: null, name: "", url: "", secret: "", enabled: true })}
        >
          + Add Hosting Point
        </button>
      </div>

      <Modal id="hostingPointModal" open={Boolean(draft)} onClose={() => setDraft(null)}>
        {draft && (
          <>
            <div className="modal-title" id="hpModalTitle">{draft.id ? "Edit Hosting Point" : "Add Hosting Point"}</div>
            <div className="modal-desc" id="hpModalDesc">
              {draft.id
                ? "Update this hosting point. Leave the secret blank to keep it unchanged."
                : "Register another Streamio server to sync library data with."}
            </div>
            <div className="form-grid full" style={{ gap: 12 }}>
              <div className="field">
                <label className="field-label">Name</label>
                <input
                  className="field-input"
                  type="text"
                  id="hpNameInput"
                  placeholder="e.g. Home Server"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label">URL</label>
                <input
                  className="field-input"
                  type="url"
                  id="hpUrlInput"
                  placeholder="https://peer.example.com"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label">Shared Secret</label>
                <input
                  className="field-input"
                  type="text"
                  id="hpSecretInput"
                  placeholder={draft.id ? "Leave blank to keep current secret" : "Leave blank to auto-generate"}
                  value={draft.secret}
                  onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
                />
                <span className="field-hint">
                  Must match the secret configured for this server on the peer&apos;s side.
                </span>
              </div>
              {draft.id && (
                <div className="field" id="hpEnabledField">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      id="hpEnabledInput"
                      checked={draft.enabled}
                      onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                    />
                    <span className="field-label" style={{ margin: 0 }}>
                      Enabled
                    </span>
                  </label>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" id="cancelHpBtn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" id="saveHpBtn" onClick={() => void save()}>
                Save
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal id="hpSecretModal" open={revealed !== null} onClose={() => setRevealed(null)}>
        {revealed !== null && (
          <>
            <div className="modal-title">Shared Secret</div>
            <div className="modal-desc">
              Copy this now — it will not be shown again. Paste it into the matching hosting-point entry on the peer
              server.
            </div>
            <div className="field">
              <input className="field-input" id="hpSecretRevealInput" type="text" readOnly value={revealed} />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                id="copyHpSecretBtn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(revealed);
                    toast("Secret copied to clipboard.");
                  } catch {
                    toast("Select and copy the secret manually.", "error");
                  }
                }}
              >
                Copy
              </button>
              <button className="btn btn-primary" id="closeHpSecretBtn" onClick={() => setRevealed(null)}>
                Done
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ── Power ──

function PowerCard({ toast }: { toast: Toast }): JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState("");
  const [minUptime, setMinUptime] = useState("");
  const [status, setStatus] = useState<PowerStatus | "error" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [requesting, setRequesting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<PowerStatus>("/api/settings/power/status"));
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api<{ enabled: boolean; idleMinutes: number; minUptimeMinutes: number }>("/api/settings/power");
        setEnabled(!!s.enabled);
        setIdleMinutes(String(s.idleMinutes));
        setMinUptime(String(s.minUptimeMinutes));
      } catch (err) {
        toast((err as Error).message, "error");
      }
    })();
    void loadStatus();
  }, [loadStatus, toast]);

  async function save(): Promise<void> {
    const idle = parseInt(idleMinutes, 10);
    const uptime = parseInt(minUptime, 10);
    if (isNaN(idle) || idle < 0) return toast("Idle minutes must be 0 or more.", "error");
    if (isNaN(uptime) || uptime < 0) return toast("Min uptime minutes must be 0 or more.", "error");
    try {
      await api("/api/settings/power", {
        method: "PUT",
        body: { enabled, idle_minutes: idle, min_uptime_minutes: uptime },
      });
      toast("Auto-shutdown settings saved.");
      void loadStatus();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function shutdown(): Promise<void> {
    setRequesting(true);
    try {
      await api("/api/settings/power/shutdown", { method: "POST" });
      toast("Shutdown requested.");
      setConfirming(false);
      void loadStatus();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setRequesting(false);
    }
  }

  async function cancelShutdown(): Promise<void> {
    try {
      await api("/api/settings/power/shutdown/cancel", { method: "POST" });
      toast("Pending shutdown cancelled.");
      void loadStatus();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  // A shutdown "request" is just a flag the app sets — the app runs in Docker
  // and can't power off the host itself. A host-side process polls for that
  // flag, on up to a ~30s delay, so the UI reflects "requested" rather than an
  // immediate state change.
  const pending = status !== null && status !== "error" && status.shouldShutdown && status.reason === "manual";

  return (
    <>
      <div className="card">
        <div className="card-title">Auto-Shutdown</div>
        <div className="section-sub" style={{ marginBottom: 12 }}>
          Automatically power off the server after it&apos;s been idle (no requests) for a while. A manual/admin
          shutdown below always works regardless of this setting.
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">Status</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" id="powerEnabledToggle" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span id="powerEnabledLabel" style={{ fontSize: "0.9rem" }}>{enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </div>
          <div className="field">
            <label className="field-label">Idle minutes</label>
            <input
              className="field-input"
              type="number"
              min="0"
              step="1"
              id="powerIdleMinutesInput"
              value={idleMinutes}
              onChange={(e) => setIdleMinutes(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">Min uptime minutes</label>
            <input
              className="field-input"
              type="number"
              min="0"
              step="1"
              id="powerMinUptimeInput"
              value={minUptime}
              onChange={(e) => setMinUptime(e.target.value)}
            />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" id="savePowerSettingsBtn" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>

      <div className="danger-card">
        <div className="danger-title">Power</div>
        <div className="danger-desc" id="powerStatusDesc">{powerStatusText(status)}</div>
        <div className="form-actions">
          {!pending && (
            <button
              className="btn btn-danger"
              id="shutdownServerBtn"
              onClick={() => {
                setConfirmText("");
                setConfirming(true);
              }}
            >
              Shut Down Server
            </button>
          )}
          {pending && (
            <button className="btn btn-ghost" id="cancelPendingShutdownBtn" onClick={() => void cancelShutdown()}>
              Cancel Pending Shutdown
            </button>
          )}
        </div>
      </div>

      <Modal id="shutdownModal" open={confirming} onClose={() => setConfirming(false)}>
        {confirming && (
          <>
            <div className="modal-title" style={{ color: "var(--red)" }}>
              Shut Down Server?
            </div>
            <div className="modal-desc">
              This will power off the physical machine running this Streamio server for everyone. It can only be turned
              back on via Wake-on-LAN. Type <strong>SHUTDOWN</strong> to confirm.
            </div>
            <div className="field">
              <input
                className="field-input"
                type="text"
                id="shutdownConfirmInput"
                placeholder="Type SHUTDOWN to confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" id="cancelShutdownModalBtn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                id="confirmShutdownBtn"
                disabled={confirmText !== "SHUTDOWN" || requesting}
                onClick={() => void shutdown()}
              >
                {requesting ? "Requesting…" : "Shut Down Now"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

function powerStatusText(status: PowerStatus | "error" | null): string {
  if (status === null) return "Loading power status…";
  if (status === "error") return "Failed to load power status.";
  if (status.shouldShutdown && status.reason === "manual")
    return "Shutdown requested — the server will power off shortly.";
  return status.enabled
    ? `Auto-shutdown is enabled after ${status.idleMinutes} min idle. Currently idle for ${Math.floor(
        (status.idleSeconds ?? 0) / 60,
      )} min.`
    : "Power off the physical machine running this server for everyone. It can only be turned back on via Wake-on-LAN.";
}
