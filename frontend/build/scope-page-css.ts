/**
 * Scopes each page's stylesheet to that page.
 *
 * The vanilla frontend loads one stylesheet per HTML document, so every page
 * could define its own `:root` palette and reuse the same class names (`nav`,
 * `.brand`, `.field`, …) without ever meeting another page's rules. In a
 * single-page app every stylesheet visited stays in the document, so the
 * copies would fight. Rather than rewriting them into CSS Modules (and every
 * class name in JSX with them), each file under `src/pages/<scope>/` is kept
 * verbatim and rewritten here at build time:
 *
 *  - `:root` / `html` become `:root[data-page="<scope>"]`,
 *  - everything else, `body` included, is prefixed with that selector,
 *  - `@keyframes` names get a `--<scope>` suffix (and the `animation`
 *    declarations in the same file follow), since two pages define `spin` or
 *    `slideUp` differently and keyframes are document-global.
 *
 * `usePageScope()` sets `data-page` on <html> for the current route. The
 * prefix raises every selector in a file by the same amount, so the file's
 * own cascade is unchanged; the one outside rule that has to beat it — the
 * high-contrast palette from preferences.ts — is written to match.
 */
import type { AtRule, Container, Plugin, Rule } from "postcss";

const PAGE_CSS = /\/src\/pages\/([^/]+)\/[^/]+\.css$/;

function insideKeyframes(rule: Rule): boolean {
  let parent: Container | undefined = rule.parent;
  while (parent) {
    if (parent.type === "atrule" && /keyframes$/i.test((parent as unknown as AtRule).name)) {
      return true;
    }
    parent = parent.parent as Container | undefined;
  }
  return false;
}

export function scopeSelector(selector: string, scope: string): string[] {
  const sel = selector.trim();
  const root = sel.match(/^(:root|html)(?![\w-])/);
  if (root) return [scope + sel.slice(root[0].length)];
  // A bare pseudo-element (`::-webkit-scrollbar`) also styled the document's
  // own scrollbar; keep that as well as the descendant form.
  if (sel.startsWith("::")) return [`${scope}${sel}`, `${scope} ${sel}`];
  return [`${scope} ${sel}`];
}

export function scopePageCss(): Plugin {
  return {
    postcssPlugin: "streamio-scope-page-css",
    Once(root) {
      const file = (root.source?.input.file ?? "").replace(/\\/g, "/");
      const match = file.match(PAGE_CSS);
      if (!match) return;
      const page = match[1];
      const scope = `:root[data-page="${page}"]`;

      const renamed = new Map<string, string>();
      root.walkAtRules(/keyframes$/i, (at) => {
        const name = at.params.trim();
        const scoped = `${name}--${page}`;
        renamed.set(name, scoped);
        at.params = scoped;
      });
      if (renamed.size) {
        root.walkDecls(/^(-webkit-)?animation(-name)?$/i, (decl) => {
          decl.value = decl.value.replace(/[A-Za-z_][\w-]*/g, (word) => renamed.get(word) ?? word);
        });
      }

      root.walkRules((rule) => {
        if (insideKeyframes(rule)) return;
        rule.selectors = rule.selectors.flatMap((s) => scopeSelector(s, scope));
      });
    },
  };
}
