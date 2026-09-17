/**
 * Display metadata for the content providers.
 *
 * The server owns every label — `GET /api/providers` sends a `displayName` and
 * `description` with each entry — so there is deliberately no table of them
 * here. A hardcoded one would name sources this bundle must know nothing about
 * and would go stale the moment a source is added, renamed or removed.
 *
 * Instead the labels the server sent are remembered as they arrive
 * (`rememberCatalog`, called automatically by `groupFamilies`) and shared
 * across pages, because some pages render a provider chip from a stored slug
 * without ever fetching the catalogue themselves. A slug we have never been
 * told about falls back to the slug itself, humanized.
 */
const LABEL_STORAGE_KEY = "streamio.providerLabels";

/** slug → { name, desc }, seeded from storage so a first paint has labels. */
const labels = new Map(Object.entries(readStoredLabels()));

function readStoredLabels() {
  try {
    return JSON.parse(localStorage.getItem(LABEL_STORAGE_KEY) || "{}") || {};
  } catch {
    // Private mode, blocked site data, or a corrupt value — labels are a
    // nicety, so this degrades to the humanized slug rather than throwing.
    return {};
  }
}

/**
 * Records the labels in a `GET /api/providers` catalog. Safe to call often —
 * it only writes when something actually changed.
 */
export function rememberCatalog(catalog = []) {
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
    localStorage.setItem(
      LABEL_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(labels)),
    );
  } catch {
    // Storage unavailable — the in-memory map still serves this page.
  }
}

export function getName(p) {
  if (!p) return "";
  return labels.get(p)?.name || p.charAt(0).toUpperCase() + p.slice(1);
}

export function getDesc(p) {
  return labels.get(p)?.desc || "Streaming content source";
}

/**
 * Fallback label for a language code. The server sends a `label` with every
 * language it offers; this only covers an install that predates that field.
 */
const languageNames = {
  it: "Italiano",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  "es-mx": "Español (México)",
  "es-ar": "Español (Argentina)",
  pl: "Polski",
};

export function getLanguageLabel(code) {
  if (!code) return "";
  return languageNames[code] || code.toUpperCase();
}

/**
 * Groups the server's flat provider `catalog` into one entry per source, with
 * the languages it is available in.
 *
 * The catalog is deliberately flat — one entry per language variant — because
 * clients that predate provider families render it as-is. Everything that
 * shows a picker groups it here instead, so a source with two languages is one
 * card plus a language selector rather than two unrelated-looking sources.
 *
 * Languages are built from the catalog entries themselves rather than from an
 * entry's `languages` array, so the picker can never offer a slug the visitor
 * isn't allowed to select. Passing plain `{ name }` objects (all an old install
 * can give us) yields one single-language family each, which renders exactly as
 * the ungrouped list did.
 */
export function groupFamilies(catalog = []) {
  // Every page that renders a picker passes through here, which is what keeps
  // the shared label cache fed for the pages that don't fetch the catalogue.
  rememberCatalog(catalog);

  const families = [];
  const byId = new Map();

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

    // The family is named after its default variant — the one whose slug is
    // the family id. Until that one is seen, any variant's label beats none.
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
