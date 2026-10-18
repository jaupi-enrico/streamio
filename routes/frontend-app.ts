import fs from "node:fs";
import path from "node:path";
import express from "express";
/**
 * The React frontend's built index.html (`frontend/`, built by
 * `npm run build:frontend` into dist/frontend), rendered for one mount.
 *
 * The bundle is built with a relative base because two things are only known
 * at request time: where this copy of the app is mounted ("" on the live site) and the path prefix,
 * if any, that a reverse proxy strips before the request reaches us.
 *
 * The prefix is deliberately **not** taken from APP_URL. APP_URL says where
 * the install is *advertised*, not where the browser ends up: an install
 * behind the tunnel/redirect front end is advertised at
 * `https://host/streamio` but 302s the browser to the tunnel's root, where a
 * `/streamio/...` asset URL 404s and the page renders blank. Only the browser
 * knows the path it is really on, so the page works it out itself: the server
 * sends the path *it* was asked for, and whatever the browser's own pathname
 * has in front of that is the prefix a proxy stripped ("" when none). That is
 * right for a strip-prefix proxy, a redirect to a bare origin, and no proxy.
 *
 * The inline script then writes `window.__STREAMIO_CONFIG__` (router
 * basename, API URLs — frontend/src/lib/base.ts) and a `<base href>`, so the
 * hashed assets after it resolve under the prefix on any route depth.
 *
 * Used by public.router.ts (mount "").
 */

export const FRONTEND_DIR = path.resolve(process.cwd(), "dist", "frontend");
const INDEX_FILE = path.join(FRONTEND_DIR, "index.html");

let cached: { mtimeMs: number; html: string } | null = null;

/** The template, re-read only when a rebuild changed it. Null when not built. */
function readTemplate(): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(INDEX_FILE);
  } catch {
    cached = null;
    return null;
  }
  if (!cached || cached.mtimeMs !== stat.mtimeMs) {
    cached = { mtimeMs: stat.mtimeMs, html: fs.readFileSync(INDEX_FILE, "utf8") };
  }
  return cached.html;
}

export function frontendBuilt(): boolean {
  return readTemplate() !== null;
}

/** JSON that is safe inside a <script> element (no `</script>`, no `<!--`). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export interface AppIndexOptions {
  /** Where the app is mounted: "" for the live site. No trailing slash. */
  mount: string;
  /** The request's path as this server received it (`req.originalUrl`, no query). */
  requestPath: string;
  /** Extra <head> markup (Open Graph tags), already escaped by the caller. */
  headExtra?: string;
}

/**
 * Runs in the page's <head> before anything else: derives the prefix (see
 * above), publishes the config and inserts the <base>. Kept dependency-free
 * and tiny; the values are spliced in as JSON.
 */
function bootScript(config: { mount: string }, requestPath: string): string {
  return `<script>(function(){
var c=${scriptJson(config)},s=${scriptJson(requestPath)},p=location.pathname,x="";
if(p.length>=s.length&&p.slice(p.length-s.length)===s)x=p.slice(0,p.length-s.length).replace(/\\/+$/,"");
c.prefix=x;window.__STREAMIO_CONFIG__=c;
var b=document.createElement("base");b.href=x+c.mount+"/";document.head.prepend(b);
})();</script>`;
}

/** The rendered page, or null when the frontend hasn't been built. */
export function renderAppIndex({ mount, requestPath, headExtra = "" }: AppIndexOptions): string | null {
  const template = readTemplate();
  if (template === null) return null;

  return template
    .replace("<!--streamio:config-->", bootScript({ mount }, requestPath))
    .replace("<!--streamio:og-->", headExtra);
}

/**
 * The built bundle's files (hashed assets, icons, vendored ffmpeg) as static
 * responses. `index: false` and the `/index.html` skip keep the raw template —
 * which has no config injected — from ever being served as a page.
 */
export function frontendAssets(): express.RequestHandler {
  const files = express.static(FRONTEND_DIR, {
    index: false,
    // Its trailing-slash redirect would answer with a root-relative Location
    // that drops a path-prefixed install's prefix.
    redirect: false,
    setHeaders: (res, filePath) => {
      // Vite content-hashes everything under assets/, so a file there never
      // changes; icons and other public/ copies keep a short TTL.
      const hashed = filePath.startsWith(path.join(FRONTEND_DIR, "assets") + path.sep);
      res.setHeader("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "public, max-age=3600");
    },
  });
  return (req, res, next) => {
    if (req.path === "/index.html" || !frontendBuilt()) {
      next();
      return;
    }
    files(req, res, next);
  };
}
