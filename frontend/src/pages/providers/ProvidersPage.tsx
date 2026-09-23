/**
 * Pick the active provider — a port of public/providers.html +
 * scripts/providers.js. The selection lives in localStorage
 * (`streamio.provider`), shared with every page of both frontends; labels
 * come only from `GET /api/providers`.
 */
import { useEffect, useMemo, useState, type JSX } from "react";
import { BottomNav } from "../../components/layout/BottomNav";
import { TopNav } from "../../components/layout/TopNav";
import { useToast } from "../../components/ui/Toast";
import { useLoadPreferences } from "../../hooks/usePreferences";
import { usePageScope } from "../../hooks/usePageScope";
import { useQuietSession } from "../../hooks/useQuietSession";
import { usePublicQuery } from "../../lib/api";
import { getName, groupFamilies, type ProviderFamilyView } from "../../lib/provider-names";
import { getSelectedProvider, setSelectedProvider } from "../../lib/provider-selection";
import type { ProvidersResponse } from "../../lib/types";
import "./providers.css";

/** The language of `family` that is selected right now, if any. */
function activeLanguage(family: ProviderFamilyView, current: string) {
  return family.languages.find((l) => l.slug === current) ?? null;
}

/** What clicking the card itself selects: the current language, else the first. */
function targetSlug(family: ProviderFamilyView, current: string): string {
  return (activeLanguage(family, current) ?? family.languages[0])?.slug ?? "";
}

/** The active source's own label, language included when it has more than one. */
function currentLabel(families: ProviderFamilyView[], current: string): string {
  for (const family of families) {
    const language = activeLanguage(family, current);
    if (!language) continue;
    return family.languages.length > 1 ? `${family.displayName} · ${language.label}` : family.displayName;
  }
  return getName(current);
}

export default function ProvidersPage(): JSX.Element {
  usePageScope("providers", "Streamio - Providers");
  useLoadPreferences();

  // Which providers the server lists depends on who is asking.
  const sessionReady = useQuietSession();
  const query = usePublicQuery<ProvidersResponse>(sessionReady ? "/api/providers/" : null);
  const [current, setCurrent] = useState(getSelectedProvider);
  const { toast, show } = useToast();

  const allProviders = query.data?.providers;
  const families = useMemo(() => {
    if (!query.data) return [];
    const names = query.data.providers ?? [];
    // `catalog` is flat, one entry per language; an install that predates it
    // gives only bare names, which group into one family each.
    return groupFamilies(query.data.catalog?.length ? query.data.catalog : names.map((name) => ({ name })));
  }, [query.data]);

  // The server drops a provider the visitor may no longer use (18+ turned
  // off, signed out), so a stale selection has to go with it.
  useEffect(() => {
    if (allProviders && current && !allProviders.includes(current)) {
      setCurrent("");
      setSelectedProvider("");
    }
  }, [allProviders, current]);

  function switchTo(slug: string) {
    if (!slug || slug === current) return;
    setCurrent(slug);
    setSelectedProvider(slug);
    show(`Switched to ${currentLabel(families, slug)}`);
  }

  let list: JSX.Element | JSX.Element[];
  if (query.isError) {
    list = <p className="empty">Error: {query.error.message}</p>;
  } else if (!query.data) {
    list = <p className="empty">Loading providers…</p>;
  } else if (!families.length) {
    list = <p className="empty">No providers found.</p>;
  } else {
    list = families.map((family, i) => {
      const isActive = Boolean(activeLanguage(family, current));
      const target = targetSlug(family, current);
      return (
        <div
          key={family.id}
          className={`provider-card${isActive ? " active" : ""}`}
          style={{ animationDelay: `${i * 0.06}s` }}
          data-slug={target}
          onClick={() => switchTo(target)}
        >
          <div className="provider-info">
            <div className="provider-name">
              {family.displayName}
              {family.adult && <span className="adult-chip">18+</span>}
              {isActive && <span className="active-chip">Active</span>}
            </div>
            <div className="provider-sub">{family.description}</div>
            {/* A source in one language shows no selector at all. */}
            {family.languages.length > 1 && (
              <div className="provider-langs">
                {family.languages.map((l) => (
                  <button
                    key={l.slug}
                    className={`lang-btn${l.slug === current ? " active" : ""}`}
                    data-slug={l.slug}
                    onClick={(e) => {
                      e.stopPropagation();
                      switchTo(l.slug);
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={`switch-btn${isActive ? " active" : ""}`}
            data-slug={target}
            onClick={(e) => {
              e.stopPropagation();
              switchTo(target);
            }}
          >
            {isActive ? "✓ Active" : "Switch"}
          </button>
        </div>
      );
    });
  }

  return (
    <>
      <TopNav active="providers" />

      <div className="page-wrap">
        <div className="page-hero">
          <h1>Providers</h1>
          <p>Switch your active streaming source</p>
        </div>

        <div className="providers-wrap">
          {current && (
            <div id="activeBanner" style={{ display: "flex" }} className="active-banner">
              <div className="active-dot" />
              <div className="active-banner-text">
                <strong id="activeName">{currentLabel(families, current)}</strong>
                <span>Currently active provider</span>
              </div>
            </div>
          )}

          <div className="section-label">Available providers</div>
          <div className="provider-list" id="providerList">
            {list}
          </div>
        </div>
      </div>

      {toast}
      <BottomNav active="providers" />
    </>
  );
}
