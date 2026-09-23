/**
 * Turning a resolved stream payload into something a <video> can load.
 * Ports of decodeManifestSource / needsSourceProxy / proxyInsecureSource /
 * readRefererHeader / buildPlayableUrl in public/scripts/watch.js.
 *
 * No provider is named here on purpose: whether a stream needs the proxy is
 * read off the payload (its scheme, its headers), never off a host list.
 */
import { apiUrl } from "../../../lib/base";

/** What `POST /api/episodes/:id/video` answers with, as far as this page reads it. */
export interface StreamPayload {
  playlistUrl?: string;
  source?: string;
  url?: string;
  type?: string;
  headers?: Record<string, unknown> | null;
  subtitles?: SubtitleSource[];
  captions?: SubtitleSource[];
}

export interface SubtitleSource {
  url?: string;
  file?: string;
  src?: string;
  label?: string;
  lang?: string;
  default?: boolean;
  initialDefault?: boolean;
}

/** The raw source string a payload carries, whichever field it used. */
export function rawSourceOf(payload: StreamPayload | null | undefined): string {
  return payload?.playlistUrl || payload?.source || payload?.url || "";
}

export function decodeManifestSource(source: string): string {
  if (!source) return "";
  if (source.startsWith("data:")) {
    const ci = source.indexOf(",");
    if (ci === -1) return "";
    const meta = source.slice(0, ci),
      payload = source.slice(ci + 1);
    if (meta.includes(";base64")) return atob(payload);
    return decodeURIComponent(payload);
  }
  return source.trim();
}

/**
 * A plain http:// source on an https page is mixed content the browser blocks
 * before hls.js sees it; a payload carrying headers needs a Referer/Origin a
 * page cannot set on a cross-origin request. Either way only a server-side
 * fetch can play it.
 */
export function needsSourceProxy(
  url: string,
  payload: StreamPayload | null | undefined,
  pageProtocol: string = location.protocol,
): boolean {
  if (pageProtocol === "https:" && /^http:\/\//i.test(url)) return true;
  try {
    if (payload && payload.headers && Object.keys(payload.headers).length > 0) return true;
  } catch {
    /* not proxied */
  }
  return false;
}

/** The payload's Referer header, whatever case the resolver spelled it in. */
export function readRefererHeader(payload: StreamPayload | null | undefined): string {
  const headers = payload && payload.headers;
  if (!headers || typeof headers !== "object") return "";
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "referer" && /^https?:\/\//i.test(String(value || ""))) {
      return String(value);
    }
  }
  return "";
}

/**
 * `url`, or the same URL looped through /api/cast-proxy when the page can't
 * fetch it itself. Addressed through apiUrl() — the vanilla page wrote it
 * root-relative, which drops a path-prefixed install's mount.
 */
export function proxyInsecureSource(
  url: string,
  payload: StreamPayload | null | undefined,
  pageProtocol: string = location.protocol,
): string {
  if (!needsSourceProxy(url, payload, pageProtocol)) return url;
  const referer = readRefererHeader(payload);
  const ref = referer ? "ref=" + encodeURIComponent(referer) + "&" : "";
  return apiUrl("/api/cast-proxy?direct=1&" + ref + "url=" + encodeURIComponent(url));
}

/**
 * What to hand the media element: an inline manifest (to be wrapped in a
 * blob: URL by the caller, which owns revoking it), a URL, or nothing.
 */
export type PlayableSource = { kind: "manifest"; text: string } | { kind: "url"; url: string } | { kind: "none" };

export function playableSource(
  payload: StreamPayload | null | undefined,
  pageProtocol: string = location.protocol,
): PlayableSource {
  const source = rawSourceOf(payload);
  if (!source) return { kind: "none" };
  if (source.startsWith("#EXTM3U")) return { kind: "manifest", text: source };
  if (source.startsWith("data:")) {
    const manifest = decodeManifestSource(source);
    if (manifest.startsWith("#EXTM3U")) return { kind: "manifest", text: manifest };
    return manifest ? { kind: "url", url: manifest } : { kind: "none" };
  }
  return { kind: "url", url: proxyInsecureSource(source, payload, pageProtocol) };
}

/** A plain progressive file (MP4 and kin), which hls.js can't load. */
export function isProgressiveSource(url: string, type: string | undefined): boolean {
  return (
    url.startsWith("http") &&
    !/\.m3u8(\?|$)/i.test(url) &&
    (/^video\//i.test(type || "") || /\.(mp4|m4v|webm|mov)(\?|$)/i.test(url))
  );
}

/**
 * The payload's headers minus the ones a browser refuses to set on an XHR
 * anyway — dropping them only saves the "unsafe header" console noise.
 */
export function safeRequestHeaders(payload: StreamPayload | null | undefined): Record<string, string> {
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([k]) => !["user-agent", "cookie", "referer", "origin"].includes(k.toLowerCase()))
      .map(([k, v]) => [k, String(v)]),
  );
}
