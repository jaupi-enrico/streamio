/**
 * Where this app is mounted, as told by the server.
 *
 * Written by the inline boot script Express puts in index.html
 * (routes/frontend-app.ts): whether this copy of the app is the side-by-side
 * preview ("/preview") or the live site (""), and the path prefix a reverse
 * proxy stripped — derived in the browser from where the page really is,
 * not from APP_URL, which can name a URL the browser is redirected away from.
 *
 * Every URL the app builds goes through here. The vanilla pages address
 * everything root-relative; this app does not, so it keeps working when the
 * proxy only forwards the prefixed paths.
 */

export interface StreamioConfig {
  /** Reverse-proxy path prefix, no trailing slash: "" or "/streamio". */
  prefix: string;
  /** "/preview" for the side-by-side copy, "" once switched over. */
  mount: string;
  /**
   * Pages switched over to this app on the live site (REACT_PAGES). Only
   * read when `mount` is "": the live copy may route client-side to these
   * and nothing else.
   */
  livePages: string[];
}

declare global {
  interface Window {
    __STREAMIO_CONFIG__?: Partial<StreamioConfig>;
  }
}

function trimSlash(s: unknown): string {
  return typeof s === "string" ? s.replace(/\/+$/, "") : "";
}

function readConfig(): StreamioConfig {
  const raw = (typeof window !== "undefined" && window.__STREAMIO_CONFIG__) || {};
  return {
    prefix: trimSlash(raw.prefix),
    mount: raw.mount === undefined ? "/preview" : trimSlash(raw.mount),
    livePages: Array.isArray(raw.livePages) ? raw.livePages.filter((p) => typeof p === "string") : [],
  };
}

export const config: StreamioConfig = readConfig();

export const isPreview = config.mount !== "";

/** React Router's basename: everything the router matches sits under it. */
export const routerBasename = `${config.prefix}${config.mount}` || "/";

/** A server path ("/api/…", "/ws/…") under the install's prefix. */
export function apiUrl(path: string): string {
  return `${config.prefix}${path}`;
}

/** A page of the vanilla frontend ("/details?id=…"). */
export function oldPageHref(path: string): string {
  return `${config.prefix}${path}`;
}

/** A page of this app, as a full path from the origin. */
export function appPageHref(path: string): string {
  return `${config.prefix}${config.mount}${path}`;
}

/** Absolute ws(s):// URL for a server path, same host as the page. */
export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${apiUrl(path)}`;
}
