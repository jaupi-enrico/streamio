/**
 * Open Graph tags for shared details pages (routes/og-meta.ts). The one rule
 * that matters: a crawler is anonymous, so an 18+ title — flagged, behind a
 * gate, or from an adult source — must produce no tags at all, and nothing
 * may fail or stall the page.
 *
 * Runs against dist/ (npm run build first); no database or network — the
 * platform handler is a stub.
 */
const { createDetailsOgRenderer } = await import("../dist/routes/og-meta.js");

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const shows = {
  plain: { id: "plain", title: 'Plain "Title" <b>', overview: "An overview.", poster: "/api/local-media/p.jpg" },
  series: { id: "series", title: "A Series", overview: "", poster: "https://img.example/p.jpg", seasons: [] },
  flagged: { id: "flagged", title: "Flagged", overview: "x", adult: true },
  gated: { id: "gated", title: "Gated", overview: "x", adult: true, adultGate: "local" },
  slow: { id: "slow", title: "Slow", overview: "x" },
};

function handler({ adultProvider = false } = {}) {
  return {
    getDefaultProviderName: () => "local",
    getProviderByName: (name) => (name === "local" || name === "adultsrc" ? {} : undefined),
    isAdultProvider: (name) => adultProvider || name === "adultsrc",
    adultGatesFor: () => ["local"],
    getShowDetails: async (_provider, id) => {
      if (id === "slow") await new Promise((r) => setTimeout(r, 3000));
      if (!shows[id]) throw new Error("not found");
      return shows[id];
    },
  };
}

process.env.APP_URL = "https://host.example/streamio";
const render = createDetailsOgRenderer(handler(), {});

console.log("og tags");

await check("describe an ordinary title, escaped, with an absolute prefixed image", async () => {
  const html = await render({ id: "plain" });
  assert(html.includes('og:title" content="Plain &quot;Title&quot; &lt;b&gt;"'), `title not escaped: ${html}`);
  assert(html.includes('og:image" content="https://host.example/streamio/api/local-media/p.jpg"'), `image: ${html}`);
  assert(html.includes('og:type" content="video.movie"'), "type");
  assert(html.includes('og:url" content="https://host.example/streamio/details?id=plain"'), `url: ${html}`);
});

await check("a series is a tv_show and an empty overview adds no description", async () => {
  const html = await render({ id: "series", provider: "local" });
  assert(html.includes('og:type" content="video.tv_show"'), "type");
  assert(!html.includes("description"), "description should be dropped");
  assert(html.includes('og:image" content="https://img.example/p.jpg"'), "absolute image kept");
});

await check("an adult-flagged title gets no tags", async () => {
  assert((await render({ id: "flagged" })) === "", "flagged title described");
  assert((await render({ id: "gated" })) === "", "gated title described");
});

await check("an adult source gets no tags", async () => {
  assert((await render({ id: "plain", provider: "adultsrc" })) === "", "adult source described");
});

await check("unknown ids, unknown providers and missing ids get no tags", async () => {
  assert((await render({ id: "nope" })) === "", "unknown id");
  assert((await render({ id: "plain", provider: "nope" })) === "", "unknown provider");
  assert((await render({})) === "", "no id");
});

await check("a slow provider is abandoned instead of holding the page", async () => {
  const start = Date.now();
  assert((await render({ id: "slow" })) === "", "slow provider described");
  assert(Date.now() - start < 2500, "waited too long");
});

if (failures) {
  console.log(`\n${failures} og-meta test(s) failed.`);
  process.exit(1);
}
console.log("\nAll og-meta tests passed.");
