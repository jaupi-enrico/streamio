/**
 * preferences.js — the common, site-wide preferences every account has.
 *
 * They are ordinary rows of `user_preferences` (the same key/value store the
 * account page's "Custom" list edits), so the server needs no knowledge of
 * them. What *this* module owns is which keys are "common", how each one is
 * presented, and its default — the account page renders from
 * `PREFERENCE_GROUPS`, every other page reads values through
 * `getPreferences()`/`loadPreferences()`, so the two can't drift apart.
 *
 * Every default is what the site did before the preference existed: an
 * account that never opens the tab, and a logged-out visitor, see no change.
 *
 * The one exception to "the server knows nothing": `share_privacy` is
 * enforced in `services/share.service.ts`, since a check only the web page
 * ran would not stop the app or a direct API call. Its option values are
 * mirrored there.
 */
import { getAccessToken, ensureSessionQuietly, fetchPublic } from "/scripts/auth.js";

/** localStorage key of the cached values — also cleared by auth.js logout(). */
export const PREFS_CACHE_KEY = "streamio.prefs";

const LANGUAGE_OPTIONS = [
  { value: "", label: "First available" },
  { value: "it", label: "Italiano" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
];

export const PREFERENCE_GROUPS = [
  {
    title: "Playback",
    items: [
      {
        key: "controls_on_seek",
        label: "Show controls when skipping",
        desc: "Bring up the control bar when seeking with the keyboard or media keys. Off shows only the small +10s indicator.",
        type: "bool",
        default: true,
      },
      {
        key: "seek_step",
        label: "Arrow key skip",
        desc: "How far ← / → jump. J / L stay at 10s, Shift + arrows at 30s.",
        type: "select",
        default: 5,
        options: [5, 10, 15, 30].map((s) => ({ value: s, label: `${s} seconds` })),
      },
      {
        key: "autoplay",
        label: "Autoplay next episode",
        desc: "Start the next episode automatically when one ends.",
        type: "bool",
        default: true,
      },
      {
        key: "auto_skip_intro",
        label: "Skip intros automatically",
        desc: "Jump over intros and recaps when their timestamps are known, without pressing Skip.",
        type: "bool",
        default: false,
      },
      {
        key: "resume_playback",
        label: "Resume where you left off",
        desc: "Continue from your last position. Off always starts from the beginning.",
        type: "bool",
        default: true,
      },
      {
        key: "playback_speed",
        label: "Default speed",
        type: "select",
        default: 1,
        options: [0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => ({
          value: r,
          label: r === 1 ? "Normal" : `${r}×`,
        })),
      },
      {
        key: "default_quality",
        label: "Default quality",
        desc: "Starting quality when a stream offers several. You can still change it while watching.",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "Auto" },
          { value: "highest", label: "Highest" },
          { value: "1080", label: "1080p" },
          { value: "720", label: "720p" },
          { value: "480", label: "480p" },
        ],
      },
      {
        key: "subtitles",
        label: "Subtitles on by default",
        type: "bool",
        default: true,
      },
      {
        key: "preferred_lang",
        label: "Subtitle language",
        desc: "Preferred track when a title has several.",
        type: "select",
        default: "",
        options: LANGUAGE_OPTIONS,
      },
      {
        key: "episode_layout",
        label: "Episode list",
        desc: "Auto switches to the compact grid for very long shows.",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "Auto" },
          { value: "cards", label: "Cards" },
          { value: "compact", label: "Compact" },
        ],
      },
      {
        key: "hide_spoilers",
        label: "Hide spoilers",
        desc: "Hide the description and thumbnail of episodes you haven't watched yet.",
        type: "bool",
        default: false,
      },
    ],
  },
  {
    title: "Browsing",
    items: [
      {
        key: "show_continue_watching",
        label: "Continue Watching on home",
        type: "bool",
        default: true,
      },
      {
        key: "hero_autoplay",
        label: "Rotate the home banner",
        desc: "Cycle through featured titles automatically.",
        type: "bool",
        default: true,
      },
      {
        key: "search_history",
        label: "Remember recent searches",
        desc: "Kept on this device only. Turning it off also clears it.",
        type: "bool",
        default: true,
      },
      {
        key: "search_sort",
        label: "Default search order",
        type: "select",
        default: "relevance",
        options: [
          { value: "relevance", label: "Relevance" },
          { value: "title", label: "Title" },
          { value: "rating", label: "Rating" },
          { value: "year", label: "Year" },
        ],
      },
    ],
  },
  {
    title: "Privacy & social",
    items: [
      {
        key: "share_privacy",
        label: "Who can share with me",
        desc: "Shares from anyone else are refused.",
        type: "select",
        default: "everyone",
        options: [
          { value: "everyone", label: "Everyone" },
          { value: "following", label: "People I follow" },
          { value: "nobody", label: "Nobody" },
        ],
      },
    ],
  },
  {
    title: "Accessibility",
    items: [
      {
        key: "text_size",
        label: "Text size",
        type: "select",
        default: "default",
        options: [
          { value: "default", label: "Default" },
          { value: "large", label: "Large" },
          { value: "larger", label: "Larger" },
          { value: "largest", label: "Largest" },
        ],
      },
      {
        key: "readable_font",
        label: "Readable font",
        desc: "Use Atkinson Hyperlegible, a typeface designed for low vision, everywhere — including headings.",
        type: "bool",
        default: false,
      },
      {
        key: "high_contrast",
        label: "High contrast",
        desc: "Brighter secondary text and stronger borders.",
        type: "bool",
        default: false,
      },
      {
        key: "underline_links",
        label: "Underline links",
        type: "bool",
        default: false,
      },
      {
        key: "focus_highlight",
        label: "Highlight keyboard focus",
        desc: "A thick yellow outline around whatever the keyboard is on.",
        type: "bool",
        default: false,
      },
      {
        key: "reduce_motion",
        label: "Reduce motion",
        desc: "Turn off animations and transitions across the site.",
        type: "bool",
        default: false,
      },
      {
        key: "caption_size",
        label: "Subtitle size",
        type: "select",
        default: "default",
        options: [
          { value: "small", label: "Small" },
          { value: "default", label: "Default" },
          { value: "large", label: "Large" },
          { value: "xlarge", label: "Extra large" },
        ],
      },
      {
        key: "caption_style",
        label: "Subtitle style",
        type: "select",
        default: "default",
        options: [
          { value: "default", label: "Default" },
          { value: "boxed", label: "White on black box" },
          { value: "yellow", label: "Yellow on black box" },
          { value: "outline", label: "White with outline, no box" },
        ],
      },
      {
        key: "controls_timeout",
        label: "Keep player controls visible",
        desc: "How long the control bar stays up after you stop moving the mouse.",
        type: "select",
        default: 3,
        options: [
          { value: 3, label: "3 seconds" },
          { value: 5, label: "5 seconds" },
          { value: 10, label: "10 seconds" },
          { value: 0, label: "Always" },
        ],
      },
      {
        key: "keyboard_shortcuts",
        label: "Single-key player shortcuts",
        desc: "Space, arrows, letters and numbers control the player. Turn off if they clash with a screen reader or voice control. Esc always works.",
        type: "bool",
        default: true,
      },
    ],
  },
];

const ITEMS = new Map(
  PREFERENCE_GROUPS.flatMap((g) => g.items).map((item) => [item.key, item]),
);

/** Whether `key` is one of the common preferences (vs. a custom one). */
export function isCommonPreference(key) {
  return ITEMS.has(key);
}

/** One value coerced to its preference's type, or its default. */
function coerce(item, value) {
  // Preferences are free-form JSON — anything can be stored under a key, and
  // only a value this preference actually offers may take effect.
  if (item.type === "bool") return typeof value === "boolean" ? value : item.default;
  return item.options.some((o) => o.value === value) ? value : item.default;
}

/** Every common key, typed, with defaults for anything absent or invalid. */
export function readPreferences(raw) {
  const out = {};
  for (const [key, item] of ITEMS) out[key] = coerce(item, raw?.[key]);
  return out;
}

function readCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(raw) {
  try {
    localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(raw));
  } catch {
    // Storage blocked: pages just fall back to defaults until the fetch lands.
  }
}

/** Last known values, synchronously — cache plus defaults. */
export function getPreferences() {
  return readPreferences(readCache());
}

/** Records one changed value in the cache and re-applies site-wide effects. */
export function cachePreference(key, value) {
  const raw = readCache();
  if (value === undefined) delete raw[key];
  else raw[key] = value;
  writeCache(raw);
  applyGlobalPreferences(readPreferences(raw));
}

const LOAD_TIMEOUT_MS = 4000;

/**
 * Current values from the server when signed in, the cache otherwise.
 * Never throws, never redirects, and gives up after a few seconds — a
 * preference must never be what keeps a page from loading.
 */
export async function loadPreferences() {
  await ensureSessionQuietly();
  if (!getAccessToken()) {
    // Signed out: defaults, and nothing left behind from a previous account.
    writeCache({});
    const prefs = readPreferences({});
    applyGlobalPreferences(prefs);
    return prefs;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const res = await fetchPublic("/api/account/preferences", {
      signal: controller.signal,
    });
    if (res.ok) {
      const raw = await res.json();
      if (raw && typeof raw === "object") writeCache(raw);
    }
  } catch {
    // Offline or slow — keep whatever the cache says.
  } finally {
    clearTimeout(timer);
  }
  const prefs = getPreferences();
  applyGlobalPreferences(prefs);
  return prefs;
}

const A11Y_STYLE_ID = "streamio-a11y";
const READABLE_FONT_ID = "streamio-readable-font";
const READABLE_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap";

// Every page sizes its text in rem, so scaling the root scales the site.
const TEXT_SCALE = { default: null, large: "112.5%", larger: "125%", largest: "137.5%" };
// ::cue takes a font-size relative to the video's own caption box.
const CAPTION_SCALE = { small: "80%", default: null, large: "130%", xlarge: "165%" };
const CAPTION_STYLE = {
  default: null,
  boxed: "color: #fff; background-color: rgba(0,0,0,0.9);",
  yellow: "color: #ffe600; background-color: rgba(0,0,0,0.9);",
  outline:
    "color: #fff; background-color: transparent; text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 6px #000;",
};

/**
 * The rules for the current values. Built as text rather than toggled by
 * class, because ::cue can't reliably read custom properties and the text
 * scale is a value, not an on/off. Each page's stylesheet keeps its own
 * palette on :root; `html.high-contrast` outranks those rules by specificity.
 */
function accessibilityCss(prefs) {
  const rules = [];
  if (TEXT_SCALE[prefs.text_size]) {
    rules.push(`html { font-size: ${TEXT_SCALE[prefs.text_size]} !important; }`);
  }
  if (prefs.readable_font) {
    rules.push(`html body, html body *:not(svg):not(svg *) {
  font-family: "Atkinson Hyperlegible", system-ui, sans-serif !important;
  letter-spacing: normal !important;
}`);
  }
  if (prefs.high_contrast) {
    rules.push(`html.high-contrast {
  --muted: #e8e8e8; --muted2: #cfcfcf;
  --border: rgba(255,255,255,0.45); --border-hover: rgba(255,255,255,0.75); --border-h: rgba(255,255,255,0.75);
  --surface: #000; --surface2: #111; --surface3: #1c1c1c; --bg: #000;
}`);
  }
  if (prefs.underline_links) {
    rules.push(`html a:not(:has(img)) { text-decoration: underline !important; text-underline-offset: 3px; }`);
  }
  if (prefs.focus_highlight) {
    rules.push(`html :focus-visible {
  outline: 3px solid #ffd400 !important; outline-offset: 2px !important;
  box-shadow: 0 0 0 6px rgba(0,0,0,0.85) !important;
}`);
  }
  if (prefs.reduce_motion) {
    rules.push(`html *, html *::before, html *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
  scroll-behavior: auto !important;
}`);
  }
  const cue = [
    CAPTION_SCALE[prefs.caption_size] && `font-size: ${CAPTION_SCALE[prefs.caption_size]};`,
    CAPTION_STYLE[prefs.caption_style],
  ].filter(Boolean);
  if (cue.length) rules.push(`video::cue { ${cue.join(" ")} }`);
  return rules.join("\n");
}

/** Effects that apply to every page rather than to one feature. */
function applyGlobalPreferences(prefs) {
  const root = document.documentElement;
  root.classList.toggle("reduce-motion", prefs.reduce_motion);
  root.classList.toggle("high-contrast", prefs.high_contrast);

  // One injected stylesheet instead of an edit in every page's CSS.
  let style = document.getElementById(A11Y_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = A11Y_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = accessibilityCss(prefs);

  // The font is only downloaded by someone who asked for it.
  if (prefs.readable_font && !document.getElementById(READABLE_FONT_ID)) {
    const link = document.createElement("link");
    link.id = READABLE_FONT_ID;
    link.rel = "stylesheet";
    link.href = READABLE_FONT_URL;
    document.head.appendChild(link);
  }
}

// Applied from the cache on import, so a page doesn't animate for the moment
// before its fetch returns.
applyGlobalPreferences(getPreferences());
