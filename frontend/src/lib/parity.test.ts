/**
 * Parity between the vanilla helpers in public/scripts and their ports here,
 * for as long as both frontends are live: a change to one side that isn't
 * mirrored on the other fails this (`npm run test:frontend-parity`).
 *
 * The vanilla files are ES modules importing /scripts/auth.js by absolute
 * URL, which nothing outside a browser can resolve — so their source is read
 * as text, imports stripped (stubs passed in instead), `export` dropped, and
 * evaluated as a function body returning the bindings under test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const PUBLIC_SCRIPTS = fileURLToPath(new URL("../../../public/scripts/", import.meta.url));

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

/** Just enough of `document` for preferences.js's apply-on-import. */
function documentStub() {
  return {
    documentElement: { classList: { toggle: () => {} } },
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild: () => {} },
  };
}

function loadVanilla(file: string, names: string[], globals: Record<string, unknown> = {}): Record<string, any> {
  const source = readFileSync(PUBLIC_SCRIPTS + file, "utf8")
    .replace(/^import\s[^;]*;\s*$/gm, "")
    .replace(/^export\s+(?=(const|let|function|async function|class)\b)/gm, "");
  const body = `${source}\nreturn { ${names.join(", ")} };`;
  const params = Object.keys(globals);
  return new Function(...params, body)(...params.map((k) => globals[k]));
}

const detailsFixtures: Record<string, unknown>[] = [
  {},
  { seasons: [] },
  { seasons: [{}], released: "2019-04-02T00:00:00.000Z", runtime: 24, quality: "HD", genres: [{ name: "Drama" }] },
  { released: "2001", details: { contentType: "OVA", releaseDate: "2001-10-20", episodeCount: 12, status: "Finito" } },
  { details: { latestEpisode: 1100, seasonCount: 21, studio: "Toei" }, seasons: [] },
  { details: { seasonCount: 1 }, seasons: [] },
  { runtime: 120, details: { episodeRuntime: 120, originalTitle: "Orig", ageRating: 14, lastAirDate: "2023-05-06" } },
  { details: { episodeRuntime: 23, ageRating: "VM14", audio: { dubIta: true, original: true, language: "Giapponese" } } },
  { details: { releaseDate: "Primavera 2020", airDay: "Lunedì", seasonLabel: "Spring 2020", originalLanguage: "ja" } },
  { details: { episodeCount: 0, seasonCount: 0, latestEpisode: 0 }, quality: "" },
];

describe("preferences.ts ↔ preferences.js", () => {
  let vanilla: Record<string, any>;
  let port: typeof import("./preferences");

  beforeAll(async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vanilla = loadVanilla(
      "preferences.js",
      ["PREFERENCE_GROUPS", "PREFS_CACHE_KEY", "readPreferences", "isCommonPreference", "accessibilityCss"],
      {
        document: documentStub(),
        localStorage: memoryStorage(),
        getAccessToken: () => null,
        ensureSessionQuietly: async () => {},
        fetchPublic: async () => ({ ok: false }),
      },
    );
    port = await import("./preferences");
  });

  it("has the same groups, keys, labels, options and defaults", () => {
    expect(JSON.parse(JSON.stringify(port.PREFERENCE_GROUPS))).toEqual(
      JSON.parse(JSON.stringify(vanilla.PREFERENCE_GROUPS)),
    );
    expect(port.PREFS_CACHE_KEY).toBe(vanilla.PREFS_CACHE_KEY);
  });

  it("coerces raw values the same way", () => {
    const inputs: unknown[] = [
      {},
      null,
      "junk",
      { autoplay: false, seek_step: 10, text_size: "larger", high_contrast: true },
      { autoplay: "false", seek_step: "10", text_size: "huge", controls_timeout: 0, adult_content: true },
      { playback_speed: 1.25, preferred_lang: "ja", search_sort: "year", caption_style: "yellow" },
    ];
    for (const raw of inputs) expect(port.readPreferences(raw)).toEqual(vanilla.readPreferences(raw));
    for (const key of ["autoplay", "share_privacy", "adult_content", "nope"]) {
      expect(port.isCommonPreference(key)).toBe(vanilla.isCommonPreference(key));
    }
  });

  it("generates the same accessibility stylesheet, bar the scoped high-contrast selector", () => {
    const everything = vanilla.readPreferences({
      text_size: "largest",
      readable_font: true,
      high_contrast: true,
      underline_links: true,
      focus_highlight: true,
      reduce_motion: true,
      caption_size: "xlarge",
      caption_style: "outline",
    });
    for (const prefs of [vanilla.readPreferences({}), everything]) {
      const ported = port
        .accessibilityCss(prefs)
        .replace("html.high-contrast, :root.high-contrast[data-page] {", "html.high-contrast {");
      expect(ported).toBe(vanilla.accessibilityCss(prefs));
    }
  });
});

describe("show-meta.ts ↔ show-meta.js", () => {
  const names = ["isSeries", "showMetaParts", "showMeta", "showFacts", "formatDate", "formatNumber", "ageLabel", "audioLabel"];
  let vanilla: Record<string, any>;
  let port: typeof import("./show-meta");

  beforeAll(async () => {
    vanilla = loadVanilla("show-meta.js", names);
    port = await import("./show-meta");
  });

  it("builds the same meta lines and facts", () => {
    for (const item of [null, ...detailsFixtures]) {
      expect(port.isSeries(item as never)).toBe(vanilla.isSeries(item));
      expect(port.showMetaParts(item as never)).toEqual(vanilla.showMetaParts(item));
      expect(port.showMetaParts(item as never, 2)).toEqual(vanilla.showMetaParts(item, 2));
      expect(port.showMeta(item as never)).toBe(vanilla.showMeta(item));
      expect(port.showFacts(item as never)).toEqual(vanilla.showFacts(item));
    }
  });

  it("formats the same way", () => {
    for (const v of [null, "", "2020-01-31", "2020", "Autunno 2021", "2020-13-45"]) {
      expect(port.formatDate(v)).toBe(vanilla.formatDate(v));
    }
    for (const v of [0, 1234567, Number.NaN, "12", null]) expect(port.formatNumber(v)).toBe(vanilla.formatNumber(v));
    for (const v of [null, "", 0, 18, "VM14"]) expect(port.ageLabel(v)).toBe(vanilla.ageLabel(v));
  });
});

describe("provider-names.ts ↔ provider-names.js", () => {
  const catalog = [
    { name: "alpha", displayName: "Alpha", description: "First", family: "alpha", language: "it",
      languages: [{ code: "it", label: "Italiano", slug: "alpha" }, { code: "en", label: "English", slug: "alpha-en" }] },
    { name: "alpha-en", displayName: "Alpha EN", description: "First", family: "alpha", language: "en",
      languages: [{ code: "it", label: "Italiano", slug: "alpha" }, { code: "en", label: "English", slug: "alpha-en" }] },
    { name: "beta", adult: true },
    { name: "gamma", family: "gamma", language: "es-mx" },
  ];
  let vanilla: Record<string, any>;
  let port: typeof import("./provider-names");

  beforeAll(async () => {
    vanilla = loadVanilla("provider-names.js", ["groupFamilies", "getName", "getDesc", "getLanguageLabel"], {
      localStorage: memoryStorage(),
    });
    vi.stubGlobal("localStorage", memoryStorage());
    port = await import("./provider-names");
  });

  it("groups the catalog and labels slugs the same way", () => {
    expect(port.groupFamilies(catalog as never)).toEqual(vanilla.groupFamilies(catalog));
    for (const slug of ["alpha", "alpha-en", "beta", "unknown", ""]) {
      expect(port.getName(slug)).toBe(vanilla.getName(slug));
    }
    for (const slug of ["alpha", "unknown"]) expect(port.getDesc(slug)).toBe(vanilla.getDesc(slug));
    for (const code of ["it", "es-ar", "xx", ""]) {
      expect(port.getLanguageLabel(code)).toBe(vanilla.getLanguageLabel(code));
    }
  });
});
