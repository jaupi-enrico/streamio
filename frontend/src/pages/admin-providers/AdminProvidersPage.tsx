/**
 * Admin: enable/disable sources and clear their cached responses — a port of
 * public/admin-providers.html + scripts/admin-providers.js. Styled by the
 * account page's stylesheet, so it shares that scope.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type JSX } from "react";
import { IconAlert, IconRadio } from "../../components/icons/icons";
import { AppLink } from "../../components/layout/AppLink";
import { TopNav } from "../../components/layout/TopNav";
import { useStatusToast } from "../../components/ui/Toast";
import { useAdminAccess } from "../../hooks/useAdminAccess";
import { usePageScope } from "../../hooks/usePageScope";
import { api } from "../../lib/auth";
import { pageHref } from "../../lib/pages";
import { getLanguageLabel, groupFamilies } from "../../lib/provider-names";
import type { ProviderInfo } from "../../lib/types";
import "../account/account.css";

type AdminProvider = ProviderInfo & { disabled?: boolean };

function Empty({ icon, title, children }: { icon: JSX.Element; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export default function AdminProvidersPage(): JSX.Element {
  usePageScope("account", "Manage Providers - Streamio", "italic");
  const access = useAdminAccess();
  const queryClient = useQueryClient();
  const { toast, show } = useStatusToast();

  // A non-admin has no reason to be here at all.
  useEffect(() => {
    if (access.data === "no") window.location.href = pageHref("/account");
  }, [access.data]);

  const providers = useQuery<AdminProvider[]>({
    queryKey: ["admin-providers"],
    enabled: access.data === "yes",
    retry: false,
    queryFn: () => api<AdminProvider[]>("/api/settings/providers"),
  });

  async function toggle(slug: string, disabled: boolean) {
    try {
      await api(`/api/settings/providers/${slug}`, { method: "PUT", body: { disabled } });
      queryClient.setQueryData<AdminProvider[]>(["admin-providers"], (list) =>
        (list ?? []).map((p) => (p.name === slug ? { ...p, disabled } : p)),
      );
      show(disabled ? `${slug} disabled.` : `${slug} enabled.`);
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function clearCache(slug: string) {
    try {
      const result = await api<{ keysDeleted: number }>(`/api/settings/providers/${slug}/clear-cache`, {
        method: "POST",
      });
      show(`Cleared ${result.keysDeleted} cache ${result.keysDeleted === 1 ? "entry" : "entries"} for ${slug}.`);
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    }
  }

  let content: JSX.Element;
  if (access.data === "unknown") {
    content = (
      <Empty icon={<IconAlert />} title="Couldn't Check Access">
        The server didn't answer. This isn't a permission problem — reload to try again.
      </Empty>
    );
  } else if (!access.data || access.data === "no" || providers.isPending) {
    content = (
      <div className="empty">
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <div style={{ color: "var(--muted2)", fontSize: "0.85rem" }}>Loading providers…</div>
      </div>
    );
  } else if (providers.isError) {
    content = (
      <Empty icon={<IconAlert />} title="Couldn't Load">
        {providers.error.message || "Failed to load providers."}
      </Empty>
    );
  } else if (!providers.data.length) {
    content = (
      <Empty icon={<IconRadio />} title="No Providers">
        No content sources are registered on this server.
      </Empty>
    );
  } else {
    const list = providers.data;
    const families = groupFamilies(list);
    const bySlug = new Map(list.map((p) => [p.name, p]));
    content = (
      <>
        {families.map((family) => (
          <div className="card" key={family.id}>
            <div className="card-title">{family.displayName}</div>
            <div className="section-sub" style={{ marginBottom: 12 }}>
              {family.description}
            </div>
            <div className="pref-grid">
              {family.languages.map((lang) => {
                const disabled = bySlug.get(lang.slug)?.disabled === true;
                return (
                  <div className="pref-row" key={lang.slug}>
                    <div className="pref-info">
                      <div className="pref-key">{lang.label || getLanguageLabel(lang.code)}</div>
                      <div className="pref-desc">{lang.slug}</div>
                    </div>
                    <div className="pref-actions">
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          data-toggle-slug={lang.slug}
                          checked={!disabled}
                          onChange={(e) => void toggle(lang.slug, !e.target.checked)}
                        />
                        <span data-toggle-label={lang.slug} style={{ fontSize: "0.85rem" }}>
                          {disabled ? "Disabled" : "Enabled"}
                        </span>
                      </label>
                      <button className="btn btn-ghost btn-sm" data-clear-cache={lang.slug} onClick={() => void clearCache(lang.slug)}>
                        Clear Cache
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <TopNav signOut />

      <div className="page-body">
        <div className="section-head">
          <div>
            <div className="section-title">Manage Providers</div>
            <div className="section-sub">
              Enable or disable individual content sources and clear their cached responses.{" "}
              <AppLink to="/account">← Back to Account</AppLink>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <AppLink className="btn btn-secondary btn-sm" to="/admin/local-provider">
              My Library
            </AppLink>
          </div>
        </div>

        <div className="card">
          <div className="card-title">My Library</div>
          <div className="section-sub" style={{ marginBottom: 12 }}>
            The <strong>local</strong> provider serves content from this server itself. Upload your own movies and shows,
            with metadata filled in from a TMDB id, and they appear alongside every other source.
          </div>
          <div className="form-actions">
            <AppLink className="btn btn-secondary btn-sm" to="/admin/local-provider">
              Manage My Library
            </AppLink>
          </div>
        </div>

        <div id="providersContent">{content}</div>
      </div>

      {toast}
    </>
  );
}
