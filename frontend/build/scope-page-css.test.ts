import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { scopePageCss, scopeSelector } from "./scope-page-css.ts";

const S = ':root[data-page="login"]';

async function run(css: string, from: string): Promise<string> {
  return (await postcss([scopePageCss()]).process(css, { from })).css;
}

describe("scopeSelector", () => {
  it("maps :root and html onto the scope and prefixes the rest", () => {
    expect(scopeSelector(":root", S)).toEqual([S]);
    expect(scopeSelector("html.high-contrast .x", S)).toEqual([`${S}.high-contrast .x`]);
    expect(scopeSelector("body", S)).toEqual([`${S} body`]);
    expect(scopeSelector("body.theater .player", S)).toEqual([`${S} body.theater .player`]);
    expect(scopeSelector("*::before", S)).toEqual([`${S} *::before`]);
    expect(scopeSelector(".html-thing", S)).toEqual([`${S} .html-thing`]);
    expect(scopeSelector("::-webkit-scrollbar", S)).toEqual([`${S}::-webkit-scrollbar`, `${S} ::-webkit-scrollbar`]);
  });
});

describe("scopePageCss", () => {
  it("scopes page stylesheets and renames their keyframes", async () => {
    const out = await run(
      `:root { --red: red; }
       .spin, nav a { animation: rot 0.6s linear infinite; }
       @media (max-width: 480px) { nav { padding: 0; } }
       @keyframes rot { from { opacity: 0; } to { transform: rotate(360deg); } }`,
      "/x/frontend/src/pages/login/login.css",
    );
    expect(out).toContain(`${S} { --red: red; }`);
    expect(out).toContain(`${S} .spin, ${S} nav a { animation: rot--login 0.6s linear infinite; }`);
    expect(out).toContain(`${S} nav { padding: 0; }`);
    expect(out).toContain("@keyframes rot--login { from { opacity: 0; } to {");
  });

  it("leaves stylesheets outside src/pages alone", async () => {
    const css = ".sp-shared { color: red; }";
    expect(await run(css, "/x/frontend/src/styles/shared.css")).toBe(css);
  });
});
