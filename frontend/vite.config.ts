import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";
import { scopePageCss } from "./build/scope-page-css.ts";

const root = fileURLToPath(new URL(".", import.meta.url));

// Express, where `npm run dev` listens. The API and websockets are proxied
// to it, so in development the app and the backend share one origin — and
// therefore one refresh cookie — exactly as they do in production.
const backend = process.env.STREAMIO_BACKEND ?? "http://localhost:8080";

/**
 * In production Express fills the `<!--streamio:config-->` slot of index.html
 * (routes/public.router.ts). The dev server has no Express in front of the
 * page, so it fills the slot itself with what an unprefixed root mount gets.
 */
function devConfig(): Plugin {
  return {
    name: "streamio-dev-config",
    apply: "serve",
    transformIndexHtml(html) {
      const config = { prefix: "", mount: "" };
      return html.replace(
        "<!--streamio:config-->",
        `<script>window.__STREAMIO_CONFIG__ = ${JSON.stringify(config)};</script>`,
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  root,
  // Relative in the build: the real base (APP_URL's path prefix + the mount)
  // is only known at request time, so Express injects a <base href> and the
  // hashed assets resolve against it. The dev server needs an absolute one.
  base: command === "serve" ? "/" : "./",
  plugins: [react(), devConfig()],
  css: {
    postcss: { plugins: [scopePageCss()] },
  },
  build: {
    outDir: "../dist/frontend",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "^/(api|ws|health|internal)(/|$)": { target: backend, ws: true, changeOrigin: false },
    },
  },
  test: {
    root,
    environment: "node",
    include: ["src/**/*.test.ts", "build/**/*.test.ts"],
  },
}));
