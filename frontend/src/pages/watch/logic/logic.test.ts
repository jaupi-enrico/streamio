import { describe, expect, it } from "vitest";
import {
  episodeBadges,
  episodeProgressWidth,
  episodeStateClass,
  episodeTitle,
  initialCompact,
  seasonTabs,
  toEpisodeCard,
  viewRevealing,
  visibleEpisodes,
  type EpisodeCard,
  type ProgressEntry,
} from "./episodes";
import {
  defaultQualityLevel,
  findActiveSkipSegment,
  formatTime,
  isEffectivelyFinished,
  preferredSubtitleIndex,
  qualityRows,
  retryDelayMs,
  steppedRate,
} from "./playback";
import { decodeManifestSource, isProgressiveSource, needsSourceProxy, playableSource, readRefererHeader } from "./stream";

describe("stream", () => {
  it("proxies http on https, and anything carrying headers", () => {
    expect(needsSourceProxy("http://cdn/x.m3u8", {}, "https:")).toBe(true);
    expect(needsSourceProxy("http://cdn/x.m3u8", {}, "http:")).toBe(false);
    expect(needsSourceProxy("https://cdn/x.m3u8", { headers: { Referer: "https://a/" } }, "https:")).toBe(true);
    expect(needsSourceProxy("https://cdn/x.m3u8", { headers: {} }, "https:")).toBe(false);
  });

  it("forwards a Referer in any spelling, and only an http(s) one", () => {
    expect(readRefererHeader({ headers: { REFERER: "https://a/" } })).toBe("https://a/");
    expect(readRefererHeader({ headers: { referer: "javascript:x" } })).toBe("");
    const src = playableSource({ playlistUrl: "https://cdn/x.m3u8", headers: { referer: "https://a/" } }, "https:");
    expect(src).toEqual({
      kind: "url",
      url: "/api/cast-proxy?direct=1&ref=" + encodeURIComponent("https://a/") + "&url=" + encodeURIComponent("https://cdn/x.m3u8"),
    });
  });

  it("recognises inline manifests, plain and data:", () => {
    expect(playableSource({ source: "#EXTM3U\n#x" }, "https:")).toEqual({ kind: "manifest", text: "#EXTM3U\n#x" });
    const b64 = "data:application/vnd.apple.mpegurl;base64," + btoa("#EXTM3U\nseg.ts");
    expect(playableSource({ url: b64 }, "https:")).toEqual({ kind: "manifest", text: "#EXTM3U\nseg.ts" });
    expect(decodeManifestSource("data:text/plain,https%3A%2F%2Fa%2Fb")).toBe("https://a/b");
    expect(playableSource({}, "https:")).toEqual({ kind: "none" });
  });

  it("sends only progressive files past hls.js", () => {
    expect(isProgressiveSource("https://a/film.mp4?sig=1", undefined)).toBe(true);
    expect(isProgressiveSource("https://a/x", "video/mp4")).toBe(true);
    expect(isProgressiveSource("https://a/x.m3u8", "video/mp4")).toBe(false);
    expect(isProgressiveSource("/api/local-media/1/master.m3u8", undefined)).toBe(false);
  });
});

const season = { id: "s1", number: 1 };
const ep = (n: number, extra: Partial<EpisodeCard> = {}): EpisodeCard => ({
  ...toEpisodeCard({ id: `e${n}`, number: n, title: `Title ${n}` }, season),
  ...extra,
});

describe("episodes", () => {
  it("fills the card shape the way the vanilla page did", () => {
    expect(toEpisodeCard({ number: 3 }, season)).toMatchObject({ id: "s1-e3", title: "Episode", seasonNum: 1, episodeNum: 3 });
    expect(toEpisodeCard({}, { id: "x" })).toMatchObject({ seasonNum: "?", episodeNum: "?" });
  });

  it("drops titles that only repeat the number — with the vanilla regex's quirk", () => {
    expect(episodeTitle({ title: "Episode", episodeNum: 1 })).toBe("");
    expect(episodeTitle({ title: "4", episodeNum: 4 })).toBe("");
    expect(episodeTitle({ title: "The Pilot", episodeNum: 1 })).toBe("The Pilot");
    // The doubled escapes demand a literal backslash, so this is kept on both pages.
    expect(episodeTitle({ title: "Episodio 5", episodeNum: 5 })).toBe("Episodio 5");
  });

  it("lists badges in order and drops missing ones", () => {
    expect(episodeBadges({ runtime: 24, quality: null, dubIta: true, subIta: false })).toEqual(["24 min", "ITA"]);
  });

  it("derives watched state and bar width from progress", () => {
    const map = new Map<string, ProgressEntry>([
      ["a", { episode_id: "a", completed: true, progress_seconds: 100, duration_seconds: 100 }],
      ["b", { episode_id: "b", completed: false, progress_seconds: 30, duration_seconds: 120 }],
      ["c", { episode_id: "c", completed: false, progress_seconds: 5, duration_seconds: 120 }],
    ]);
    expect(episodeStateClass(map, "a")).toBe("completed");
    expect(episodeStateClass(map, "b")).toBe("in-progress");
    expect(episodeStateClass(map, "c")).toBe("");
    expect(episodeProgressWidth(map, "a")).toBe("");
    expect(episodeProgressWidth(map, "b")).toBe("25%");
    expect(episodeProgressWidth(map, "zz")).toBe("");
  });

  it("filters by season and query", () => {
    const list = Array.from({ length: 20 }, (_, i) => ep(i + 1));
    const all = { seasonId: "all", query: "", compact: false };
    // "Exactly" is the vanilla comment's word; its second clause matches
    // inside "s1e17" too, and the port keeps that.
    expect(visibleEpisodes(list, { ...all, query: "7" }).map((e) => e.episodeNum)).toEqual([7, 17]);
    expect(visibleEpisodes(list, { ...all, query: "title 1" }).length).toBe(11); // 1, 10-19
    expect(visibleEpisodes(list, { ...all, seasonId: "other" })).toEqual([]);
  });

  it("builds season tabs only for more than one season", () => {
    const s2 = { id: "s2", number: 2 };
    const list = [ep(1), { ...ep(2), seasonId: "s2" }];
    expect(seasonTabs([season], list)).toEqual([]);
    expect(seasonTabs([season, s2, { id: "s3", title: "Empty" }], list)).toEqual([
      { id: "all", label: "Tutti", count: 2 },
      { id: "s1", label: "Stagione 1", count: 1 },
      { id: "s2", label: "Stagione 2", count: 1 },
    ]);
  });

  it("reveals a hidden episode by clearing the filter and opening its season", () => {
    const e2 = { ...ep(2), seasonId: "s2" };
    const list = [ep(1), e2];
    const view = { seasonId: "s1", query: "1", compact: true };
    expect(viewRevealing(list, view, e2)).toEqual({ seasonId: "s2", query: "", compact: true });
    const visible = { seasonId: "all", query: "", compact: false };
    expect(viewRevealing(list, visible, e2)).toBe(visible);
  });

  it("opens long runs compact under the auto layout", () => {
    expect(initialCompact("auto", 61)).toBe(true);
    expect(initialCompact("auto", 60)).toBe(false);
    expect(initialCompact("compact", 3)).toBe(true);
    expect(initialCompact("cards", 999)).toBe(false);
  });
});

describe("playback", () => {
  it("formats times with an hour component", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(125)).toBe("2:05");
    expect(formatTime(3723)).toBe("1:02:03");
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("treats the last five seconds as finished, never a live stream", () => {
    expect(isEffectivelyFinished(100, 95)).toBe(true);
    expect(isEffectivelyFinished(100, 94)).toBe(false);
    expect(isEffectivelyFinished(Infinity, 1e9)).toBe(false);
  });

  it("backs off retries up to 8s", () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it("finds the active skip segment, intro first", () => {
    const data = { intro: [{ startMs: 0, endMs: 1000 }], credits: [{ startMs: 5000, endMs: null }] };
    expect(findActiveSkipSegment(data, 500, 9000)).toEqual({ type: "intro", start: 0, end: 1000, runsToEnd: false });
    expect(findActiveSkipSegment(data, 6000, 9000)).toEqual({ type: "credits", start: 5000, end: 9000, runsToEnd: true });
    expect(findActiveSkipSegment(data, 2000, 9000)).toBeNull();
  });

  it("starts subtitles per the preferences", () => {
    expect(preferredSubtitleIndex(["en", "it"], { subtitles: false, preferred_lang: "it" })).toBe(-1);
    expect(preferredSubtitleIndex(["en", "it-IT"], { subtitles: true, preferred_lang: "it" })).toBe(1);
    expect(preferredSubtitleIndex(["en"], { subtitles: true, preferred_lang: "it" }, 0)).toBe(0);
  });

  it("pins the default quality", () => {
    const levels = [{ height: 360 }, { height: 1080 }, { height: 720 }];
    expect(defaultQualityLevel(levels, "auto")).toBeNull();
    expect(defaultQualityLevel(levels, "highest")).toBe(1);
    expect(defaultQualityLevel(levels, "720")).toBe(2);
    expect(defaultQualityLevel(levels, "240")).toBe(0);
    expect(defaultQualityLevel([{ height: 720 }], "360")).toBeNull();
  });

  it("lists qualities highest first, disambiguating equal heights", () => {
    expect(qualityRows([{ height: 720, bitrate: 2e6 }, { height: 720, bitrate: 3e6 }, { height: 1080 }])).toEqual([
      { level: -1, label: "Auto" },
      { level: 2, label: "1080p" },
      { level: 1, label: "720p (3000 kbps)" },
      { level: 0, label: "720p (2000 kbps)" },
    ]);
  });

  it("steps speed through the same list the menu shows", () => {
    expect(steppedRate(1, 1)).toBe(1.25);
    expect(steppedRate(2, 1)).toBe(2);
    expect(steppedRate(1.1, -1)).toBe(0.75);
  });
});
