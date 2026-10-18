import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPE_HLS,
  buildCastCustomData,
  castContentType,
  castProxyUrl,
  castSubtitleList,
  type CastContext,
  type CastMedia,
} from "./cast";

const PROXY = "https://host/streamio/api/cast-proxy?url=";

const media: CastMedia = {
  url: "https://cdn/x.m3u8",
  title: "Show",
  subtitles: [
    { url: "http://subs/it.vtt", lang: "it", label: "Italiano", default: true },
    { file: "http://subs/en.vtt", lang: "en" },
    { lang: "fr" },
  ],
  type: "",
  referer: "https://ref/",
  serverName: "Main",
  serverIndex: 1,
};

function context(patch: Partial<CastContext> = {}): CastContext {
  return {
    apiBase: "https://host/streamio",
    proxyBase: PROXY,
    provider: "p",
    playbackType: "episode",
    playbackId: "ep2",
    showId: "show",
    show: { title: "Show", overview: "Plot", poster: "poster.jpg", banner: null, runtime: 24 },
    introIds: { tmdbId: null, imdbId: "tt1", year: 2020 },
    episodes: [
      { id: "ep1", seasonNum: 1, episodeNum: 1, title: "One" },
      { id: "ep2", seasonNum: 1, episodeNum: 2, title: "Two" },
    ],
    episodeIndex: 1,
    episodeLabel: "S1E2",
    duration: NaN,
    serverName: "Fallback",
    serverIndex: 0,
    autoplayNext: true,
    upNextSeconds: 20,
    media,
    ...patch,
  };
}

describe("cast payload", () => {
  it("sends the HLS content type lowercase", () => {
    expect(CONTENT_TYPE_HLS).toBe(CONTENT_TYPE_HLS.toLowerCase());
    expect(castContentType({ type: "" })).toBe("application/x-mpegurl");
    expect(castContentType({ type: "Video/MP4" })).toBe("video/mp4");
  });

  it("folds the Referer override in ahead of url=", () => {
    expect(castProxyUrl(PROXY, "https://cdn/a b", "https://ref/")).toBe(
      "https://host/streamio/api/cast-proxy?ref=https%3A%2F%2Fref%2F&url=https%3A%2F%2Fcdn%2Fa%20b",
    );
    expect(castProxyUrl(PROXY, "https://cdn/a", "")).toBe(PROXY + "https%3A%2F%2Fcdn%2Fa");
  });

  it("proxies subtitles and drops the ones with no URL", () => {
    const subs = castSubtitleList(media, PROXY);
    expect(subs).toHaveLength(2);
    expect(subs[0]).toMatchObject({ label: "Italiano", lang: "it", default: true });
    expect(subs[0]!.url.startsWith("https://host/streamio/api/cast-proxy?ref=")).toBe(true);
    expect(subs[1]).toMatchObject({ label: "en", lang: "en", default: false });
  });

  it("describes the episode being cast", () => {
    const d = buildCastCustomData(context());
    expect(d).toMatchObject({
      v: 1,
      contentType: "episode",
      showId: "show",
      imdbId: "tt1",
      year: 2020,
      seasonNumber: 1,
      episodeNumber: 2,
      episodeId: "ep2",
      episodeTitle: "Two",
      episodeLabel: "S1E2",
      durationSeconds: 24 * 60,
      serverName: "Main",
      serverIndex: 1,
      backdrop: "poster.jpg",
      episodeIndex: 1,
      autoplayNext: true,
      upNextSeconds: 20,
    });
    expect(d.episodes).toEqual([
      { id: "ep1", s: 1, e: 1, t: "One" },
      { id: "ep2", s: 1, e: 2, t: "Two" },
    ]);
  });

  it("leaves the episode fields empty for a movie, and prefers the element's duration", () => {
    const d = buildCastCustomData(context({ playbackType: "movie", duration: 5400.7 }));
    expect(d).toMatchObject({ episodeId: "", episodeLabel: "", seasonNumber: null, durationSeconds: 5400 });
  });
});
