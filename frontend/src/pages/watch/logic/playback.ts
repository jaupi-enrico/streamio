/**
 * Small pure rules the player applies. Ports of formatTime /
 * isEffectivelyFinished / findActiveSkipSegment / preferredSubtitleIndex /
 * applyDefaultQuality in public/scripts/watch.js.
 */

export const MAX_STREAM_RETRIES = 5;
export const NEXT_EP_THRESHOLD = 20; // seconds before end
// How close to the end counts as "finished". "ended" is not guaranteed to fire
// (hls.js/Safari can stop a hair short of `duration`, a seek to exactly
// `duration` often fires nothing), and the autosave after it would then write
// completed:false over a finished episode.
export const COMPLETE_TAIL = 5; // seconds
export const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Seconds → "1:02:03" / "2:03". Movies are hours long; "125:03" is not a time. */
export function formatTime(s: number): string {
  if (!isFinite(s) || isNaN(s) || s < 0) return "0:00";
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** True once playback sits inside the final COMPLETE_TAIL seconds. Live/unknown durations never are. */
export function isEffectivelyFinished(duration: number, currentTime: number): boolean {
  const d = duration;
  if (!d || isNaN(d) || !isFinite(d)) return false;
  return d - currentTime <= COMPLETE_TAIL;
}

/** The retry delay before attempt `n` (1-based): 1s, 2s, 4s, 8s, 8s. */
export function retryDelayMs(n: number): number {
  return Math.min(1000 * 2 ** (n - 1), 8000);
}

// ── Skip Intro/Recap/Credits/Preview ──

export interface IntroSegment {
  startMs: number;
  endMs: number | null;
}

export interface IntroSegments {
  intro?: IntroSegment[];
  recap?: IntroSegment[];
  credits?: IntroSegment[];
  preview?: IntroSegment[];
}

export type SkipType = "intro" | "recap" | "credits" | "preview";

export interface ActiveSkipSegment {
  type: SkipType;
  start: number;
  end: number;
  runsToEnd: boolean;
}

export const SKIP_SEGMENT_LABELS: Record<SkipType, string> = {
  intro: "Skip Intro",
  recap: "Skip Recap",
  credits: "Skip Credits",
  preview: "Skip Preview",
};

// Segments arrive already normalized by the server's client: startMs is always
// a number, endMs null means "runs to the end of the media".
export function findActiveSkipSegment(data: IntroSegments, tMs: number, durMs: number): ActiveSkipSegment | null {
  const check = (list: IntroSegment[] | undefined, type: SkipType): ActiveSkipSegment | null => {
    for (const seg of list || []) {
      const end = seg.endMs ?? durMs;
      if (tMs >= seg.startMs && tMs < end) {
        return { type, start: seg.startMs, end, runsToEnd: seg.endMs == null };
      }
    }
    return null;
  };
  return (
    check(data.intro, "intro") ||
    check(data.recap, "recap") ||
    check(data.credits, "credits") ||
    check(data.preview, "preview")
  );
}

// ── Starting tracks from the viewer's preferences ──

/**
 * Which subtitle track a new stream starts on: -1 when subtitles are off,
 * else the first track in the preferred language, else `fallback`.
 */
export function preferredSubtitleIndex(
  langs: readonly (string | null | undefined)[],
  prefs: { subtitles: boolean; preferred_lang: string },
  fallback = 0,
): number {
  if (!prefs.subtitles) return -1;
  const want = prefs.preferred_lang;
  if (want) {
    const idx = langs.findIndex((l) => String(l || "").toLowerCase().startsWith(want));
    if (idx >= 0) return idx;
  }
  return fallback;
}

/**
 * The level to pin for the `default_quality` preference, or null to leave
 * hls.js's ABR alone ("auto", or a single rendition). A height picks the
 * tallest level not above it, else the shortest level there is.
 */
export function defaultQualityLevel(levels: readonly { height?: number }[], want: string): number | null {
  if (want === "auto" || levels.length < 2) return null;
  let best = -1;
  levels.forEach((l, i) => {
    const h = l.height || 0;
    const fits = want === "highest" || h <= Number(want);
    if (fits && (best === -1 || h > (levels[best]!.height || 0))) best = i;
  });
  if (best === -1) {
    best = levels.reduce((min, l, i) => ((l.height || 0) < (levels[min]!.height || 0) ? i : min), 0);
  }
  return best;
}

/** One row of the quality menu: level -1 is "Auto". */
export interface QualityRow {
  level: number;
  label: string;
}

/**
 * The quality menu, highest first. Two renditions sharing a height get their
 * bitrate appended, or they'd render as two identical rows.
 */
export function qualityRows(levels: readonly { height?: number; bitrate?: number }[]): QualityRow[] {
  const sorted = levels
    .map((level, idx) => ({ level, idx }))
    .sort(
      (a, b) => (b.level.height || 0) - (a.level.height || 0) || (b.level.bitrate || 0) - (a.level.bitrate || 0),
    );
  const heightCount = new Map<number | undefined, number>();
  for (const { level } of sorted) heightCount.set(level.height, (heightCount.get(level.height) || 0) + 1);
  return [
    { level: -1, label: "Auto" },
    ...sorted.map(({ level, idx }) => {
      let label = level.height ? `${level.height}p` : `Level ${idx}`;
      if (level.height && (heightCount.get(level.height) || 0) > 1 && level.bitrate)
        label += ` (${Math.round(level.bitrate / 1000)} kbps)`;
      return { level: idx, label };
    }),
  ];
}

/** Steps through SPEED_STEPS so the menu and the keys can never disagree. */
export function steppedRate(current: number, direction: number): number {
  const idx = SPEED_STEPS.findIndex((s) => Math.abs(s - current) < 0.01);
  const from = idx === -1 ? SPEED_STEPS.indexOf(1) : idx;
  return SPEED_STEPS[Math.min(Math.max(from + direction, 0), SPEED_STEPS.length - 1)]!;
}
