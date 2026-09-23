/**
 * Display metadata for the content providers — a port of
 * public/scripts/provider-names.js.
 *
 * The server owns every label (`GET /api/providers` sends `displayName` and
 * `description` with each entry), so there is deliberately no table of them
 * here. Labels are remembered as they arrive and shared with the vanilla
 * pages through the same `streamio.providerLabels` localStorage key, because
 * some pages render a provider chip from a stored slug without fetching the
 * catalogue. An unknown slug falls back to the slug itself, humanized.
 */
import type { ProviderInfo } from "./types";

const LABEL_STORAGE_KEY = "streamio.providerLabels";

interface Label {
  name: string;
  desc: string;
}

function readStoredLabels(): Record<string, Label> {
  try {
    return (JSON.parse(localStorage.getItem(LABEL_STORAGE_KEY) || "{}") as Record<string, Label>) || {};
  } catch {
    // Private mode, blocked site data, or a corrupt value — labels are a
    // nicety, so this degrades to the humanized slug rather than throwing.
    return {};
  }
}

/** slug → label, seeded from storage so a first paint has labels. */
const labels = new Map<string, Label>(
  typeof localStorage === "undefined" ? [] : Object.entries(readStoredLabels()),
);

/** The catalog entry fields read here; old installs may send only `name`. */
export type CatalogEntry = Pick<ProviderInfo, "name"> & Partial<ProviderInfo>;

/** Records the labels in a catalog. Only writes when something changed. */
export function rememberCatalog(catalog: CatalogEntry[] = []): void {
  let changed = false;

  for (const entry of catalog) {
    if (!entry?.name) continue;
    const known = labels.get(entry.name);
    const name = entry.displayName || known?.name || "";
    const desc = entry.description || known?.desc || "";
    if (known?.name === name && known?.desc === desc) continue;
    labels.set(entry.name, { name, desc });
    changed = true;
  }

  if (!changed) return;
  try {
    localStorage.setItem(LABEL_STORAGE_KEY, JSON.stringify(Object.fromEntries(labels)));
  } catch {
    // Storage unavailable — the in-memory map still serves this page.
  }
}

export function getName(p: string | null | undefined): string {
  if (!p) return "";
  return labels.get(p)?.name || p.charAt(0).toUpperCase() + p.slice(1);
}

export function getDesc(p: string): string {
  return labels.get(p)?.desc || "Streaming content source";
}

/** Fallback language labels, only for an install that predates `label`. */
const languageNames: Record<string, string> = {
  it: "Italiano",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  "es-mx": "Español (México)",
  "es-ar": "Español (Argentina)",
  pl: "Polski",
};

export function getLanguageLabel(code: string | null | undefined): string {
  if (!code) return "";
  return languageNames[code] || code.toUpperCase();
}

export interface FamilyLanguage {
  code: string;
  label: string;
  slug: string;
}

export interface ProviderFamilyView {
  id: string;
  displayName: string;
  description: string;
  adult: boolean;
  languages: FamilyLanguage[];
}

/**
 * Groups the flat catalog into one entry per source, with its languages.
 * Languages come from the catalog entries themselves, so the picker can
 * never offer a slug the visitor isn't allowed to select.
 */
export function groupFamilies(catalog: CatalogEntry[] = []): ProviderFamilyView[] {
  rememberCatalog(catalog);

  const families: ProviderFamilyView[] = [];
  const byId = new Map<string, ProviderFamilyView>();

  for (const entry of catalog) {
    const id = entry.family || entry.name;
    let family = byId.get(id);

    if (!family) {
      family = {
        id,
        displayName: "",
        description: entry.description || getDesc(entry.name),
        adult: false,
        languages: [],
      };
      byId.set(id, family);
      families.push(family);
    }

    if (entry.adult) family.adult = true;

    // Named after its default variant — the one whose slug is the family id.
    if (!family.displayName || entry.name === id) {
      family.displayName = entry.displayName || getName(entry.name);
    }

    const meta = (entry.languages || []).find((l) => l.slug === entry.name);
    family.languages.push({
      code: entry.language || meta?.code || "",
      label: meta?.label || getLanguageLabel(entry.language),
      slug: entry.name,
    });
  }

  return families;
}
