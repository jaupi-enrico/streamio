/**
 * The Preferences tab.
 *
 * The common preferences — their labels, controls and defaults — live in
 * lib/preferences.ts, shared with the pages that act on them. Anything else in
 * user_preferences is listed under "Custom" as a raw key/value pair. Both are
 * the same generic `/api/account/preferences/:key` store, so adding a common
 * preference needs no backend change.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { IconAlert, IconSettings } from "../../components/icons/icons";
import { api } from "../../lib/auth";
import {
  PREFERENCE_GROUPS,
  cachePreference,
  isCommonPreference,
  readPreferences,
  type PreferenceItem,
  type Preferences,
} from "../../lib/preferences";

type Toast = (msg: string, type?: "success" | "error") => void;
type RawPrefs = Record<string, unknown>;

const PREF_META: Record<string, { desc: string }> = {
  notifications: { desc: "Receive email notifications" },
};

/** Every 18+ preference key starts with this — mirrors core/models/AdultGate.ts. */
const ADULT_KEY_PREFIX = "adult-";

/**
 * The line under a preference's name.
 *
 * 18+ gates are deliberately absent from `PREF_META`: which gates exist is
 * whatever the installed sources declare, so a list here would go stale the
 * moment one is added or renamed, and would name sources this page must know
 * nothing about. The label is derived from the key itself instead.
 */
function prefDesc(key: string): string {
  if (PREF_META[key]) return PREF_META[key].desc;
  if (!key.startsWith(ADULT_KEY_PREFIX)) return "";
  const gate = key.slice(ADULT_KEY_PREFIX.length);
  return gate === "all" ? "Show every kind of 18+ content" : `Show 18+ content of type “${gate}”`;
}

export async function savePreference(key: string, value: unknown): Promise<void> {
  await api(`/api/account/preferences/${encodeURIComponent(key)}`, { method: "PUT", body: { value } });
  cachePreference(key, value);
}

interface Props {
  toast: Toast;
  /** Opens the add/edit modal; the page owns it, as the vanilla markup does. */
  onEdit: (key: string, value: unknown) => void;
  /** Bumped by the page when a modal save needs the list reloaded. */
  reloadToken: number;
  /** The "admin access is waiting on email verification" notice, if any. */
  notice?: JSX.Element | null;
}

export function PreferencesTab({ toast, onEdit, reloadToken, notice }: Props): JSX.Element {
  const [prefs, setPrefs] = useState<RawPrefs | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrefs(await api<RawPrefs>("/api/account/preferences"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function setCustom(key: string, value: unknown): Promise<boolean> {
    try {
      await savePreference(key, value);
      setPrefs((p) => ({ ...(p ?? {}), [key]: value }));
      toast("Preference saved.");
      return true;
    } catch (err) {
      toast((err as Error).message, "error");
      return false;
    }
  }

  async function remove(key: string): Promise<void> {
    try {
      await api(`/api/account/preferences/${encodeURIComponent(key)}`, { method: "DELETE" });
      cachePreference(key, undefined);
      toast(`Preference "${key}" removed.`);
      void load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <>
      {notice}
      <div id="prefsContent">
        {failed ? (
          <div className="empty">
            <div className="empty-icon">
              <IconAlert />
            </div>
            <h3>Couldn&apos;t Load</h3>
            <p>Failed to load preferences.</p>
          </div>
        ) : prefs === null ? (
          <div className="empty">
            <div className="spinner" style={{ margin: "0 auto 16px" }} />
            <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Loading preferences…</div>
          </div>
        ) : (
          <>
            <CommonPreferences raw={prefs} toast={toast} />
            <div className="pref-group-title">Custom</div>
            <CustomPreferences prefs={prefs} onToggle={setCustom} onEdit={onEdit} onDelete={remove} />
          </>
        )}
      </div>
    </>
  );
}

function CommonPreferences({ raw, toast }: { raw: RawPrefs; toast: Toast }): JSX.Element {
  const values = readPreferences(raw);
  return (
    <div className="pref-groups">
      {PREFERENCE_GROUPS.map((group) => (
        <PrefGroup key={group.title} title={group.title} items={group.items} values={values} toast={toast} />
      ))}
    </div>
  );
}

function PrefGroup({
  title,
  items,
  values,
  toast,
}: {
  title: string;
  items: PreferenceItem[];
  values: Preferences;
  toast: Toast;
}): JSX.Element {
  return (
    <>
      <div className="pref-group-title">{title}</div>
      <div className="pref-grid">
        {items.map((item) => (
          <CommonPrefRow key={item.key} item={item} initial={(values as unknown as Record<string, unknown>)[item.key]} toast={toast} />
        ))}
      </div>
    </>
  );
}

function CommonPrefRow({ item, initial, toast }: { item: PreferenceItem; initial: unknown; toast: Toast }): JSX.Element {
  const [value, setValue] = useState<unknown>(initial);

  async function commit(next: unknown, revert: unknown): Promise<void> {
    setValue(next);
    try {
      await savePreference(item.key, next);
      toast("Preference saved.");
    } catch (err) {
      toast((err as Error).message, "error");
      setValue(revert);
    }
  }

  return (
    <div className="pref-row">
      <div className="pref-info">
        <div className="pref-key">{item.label}</div>
        {item.desc && <div className="pref-desc">{item.desc}</div>}
      </div>
      {item.type === "bool" ? (
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(value)}
            aria-label={item.label}
            onChange={(e) => void commit(e.target.checked, value)}
          />
          <span className="toggle-slider" />
        </label>
      ) : (
        // Option values can be numbers, so the <option> carries its index and
        // the typed value is looked up from the definition.
        <select
          className="field-input pref-select"
          aria-label={item.label}
          value={String(Math.max(0, (item.options ?? []).findIndex((o) => o.value === value)))}
          onChange={(e) => {
            const opt = (item.options ?? [])[Number(e.target.value)];
            if (opt) void commit(opt.value, value);
          }}
        >
          {(item.options ?? []).map((opt, i) => (
            <option key={opt.label} value={String(i)}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function CustomPreferences({
  prefs,
  onToggle,
  onEdit,
  onDelete,
}: {
  prefs: RawPrefs;
  onToggle: (key: string, value: unknown) => Promise<boolean>;
  onEdit: (key: string, value: unknown) => void;
  onDelete: (key: string) => Promise<void>;
}): JSX.Element {
  const keys = Object.keys(prefs).filter((key) => !isCommonPreference(key));
  if (!keys.length) {
    return (
      <div id="customPrefs">
        <div className="empty empty-compact">
          <div className="empty-icon">
            <IconSettings />
          </div>
          <h3>No Custom Preferences</h3>
          <p>Use “+ Add Custom” above to store your own key/value pairs.</p>
        </div>
      </div>
    );
  }
  return (
    <div id="customPrefs">
      <div className="pref-grid">
        {keys.map((key) => {
          const desc = prefDesc(key);
          const val = prefs[key];
          return (
            <div className="pref-row" key={key}>
              <div className="pref-info">
                <div className="pref-key">{key}</div>
                {desc && <div className="pref-desc">{desc}</div>}
              </div>
              {typeof val === "boolean" ? (
                <CustomToggle prefKey={key} value={val} onToggle={onToggle} />
              ) : (
                <>
                  <div className="pref-val">{JSON.stringify(val)}</div>
                  <div className="pref-actions">
                    <button className="btn btn-ghost btn-sm btn-icon" title="Edit" onClick={() => onEdit(key, val)}>
                      ✎
                    </button>
                    <button className="btn btn-danger btn-sm btn-icon" title="Delete" onClick={() => void onDelete(key)}>
                      ✕
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CustomToggle({
  prefKey,
  value,
  onToggle,
}: {
  prefKey: string;
  value: boolean;
  onToggle: (key: string, value: unknown) => Promise<boolean>;
}): JSX.Element {
  const [checked, setChecked] = useState(value);
  useEffect(() => setChecked(value), [value]);
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={async (e) => {
          const next = e.target.checked;
          setChecked(next);
          if (!(await onToggle(prefKey, next))) setChecked(!next);
        }}
      />
      <span className="toggle-slider" />
    </label>
  );
}
