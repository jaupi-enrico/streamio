// core/providers/registry.ts
//
// Provider discovery: every module in this directory that exports a
// `providerFamily` descriptor is a registered source.
//
// This exists so that adding a source — or a language of an existing one — is
// one file, not a file plus three edits to `core/core.ts` (an import, an entry
// buried in a 300-line array literal, and for anything with a dependency a
// special case at the bottom). The metadata that describes a source lives
// beside the class it describes, next to any per-variant config the class
// itself needs (see `LocalProvider.ts`).
//
// A file with no `providerFamily` export is not a provider and is skipped
// silently: that is what would keep a shared helper module placed here out of
// the registry, or let a provider class be implemented but deliberately left
// unregistered. Opting in is a single export.
//
// Everything else throws. A descriptor that is malformed, or two that claim the
// same `order`, would otherwise drop a source from every client's picker — or
// silently change which provider is the default — with nothing logged.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProviderModule } from "../models/ProviderRegistry.js";

// Resolved from this module's own location, never `process.cwd()`. The Docker
// image carries the TypeScript source alongside the compiled output (the
// Dockerfile copies the tree in and builds it there), and a stale `core/dist/`
// tree exists in some checkouts — a cwd-relative or recursive scan would find
// `.ts` files Node cannot import.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * An optional directory for providers kept outside this repository: present
 * on a machine that has them, absent on a fresh checkout, which is why every
 * read of it tolerates `ENOENT` rather than treating it as a broken install.
 * Scanned exactly like `HERE`: flat, `.js`-only, no recursion into any
 * subdirectory it may keep its own helper modules in (`readdirSync` never
 * lists inside subdirectories, so that is enforced for free).
 */
const CUSTOM_DIR = path.join(HERE, "custom");

/** This module itself. The `.js` filter already excludes tsc's `.d.ts` output. */
const SELF = path.basename(fileURLToPath(import.meta.url));

function isCandidate(file: string): boolean {
  return file.endsWith(".js") && file !== SELF;
}

/**
 * Lists candidate provider files in a directory. `custom/` is often not there
 * at all — that must behave as "zero providers here", not a boot-time crash,
 * so a missing directory is treated as empty rather than left to
 * `readdirSync`'s `ENOENT`.
 */
function listCandidates(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(isCandidate).sort();
}

function assertModuleShape(
  descriptor: unknown,
  file: string,
): asserts descriptor is ProviderModule {
  const m = descriptor as Partial<ProviderModule> | null;

  if (!m || typeof m !== "object") {
    throw new Error(
      `Provider module "${file}" exports a \`providerFamily\` that is not an object`,
    );
  }
  if (typeof m.order !== "number" || !Number.isFinite(m.order)) {
    throw new Error(
      `Provider module "${file}" must export a numeric \`order\` (got ${JSON.stringify(m.order)})`,
    );
  }
  if (typeof m.create !== "function") {
    throw new Error(
      `Provider module "${file}" must export a \`create(ctx)\` function`,
    );
  }
}

/**
 * Imports every candidate file in `dir` and picks out the ones that export a
 * `providerFamily`. `label` is only for error messages, so a clash or a
 * malformed descriptor names which directory (normal vs. `custom/`) it came
 * from rather than just a bare filename that exists in both.
 */
async function discoverIn(
  dir: string,
  label: string,
): Promise<{ module: ProviderModule; file: string; label: string }[]> {
  const found: { module: ProviderModule; file: string; label: string }[] = [];

  for (const file of listCandidates(dir)) {
    const mod: Record<string, unknown> = await import(
      pathToFileURL(path.join(dir, file)).href
    );

    // Not a provider — a shared helper, or a class deliberately left
    // unregistered. Both are legitimate residents of this directory.
    if (!("providerFamily" in mod)) continue;

    const descriptor = mod.providerFamily;
    assertModuleShape(descriptor, `${label}/${file}`);
    found.push({ module: descriptor, file, label });
  }

  return found;
}

async function discover(): Promise<ProviderModule[]> {
  // Both directories participate in the same ordering/default-provider logic
  // — a custom provider can sit anywhere in the catalogue, not just appended
  // after the normal ones — so they're merged before the uniqueness check,
  // not scanned and validated separately.
  const found = [
    ...(await discoverIn(HERE, ".")),
    ...(await discoverIn(CUSTOM_DIR, "custom")),
  ];

  if (!found.length) {
    throw new Error(
      `No provider modules found in ${HERE} or ${CUSTOM_DIR} — every provider file must export a \`providerFamily\``,
    );
  }

  // Order decides the default provider (`Core` takes the first family's first
  // variant) and the order of every catalogue a client renders, so a duplicate
  // is not a tie to break by filename — it is a bug the author has to resolve.
  const byOrder = new Map<number, string>();
  for (const { module, file, label } of found) {
    const clash = byOrder.get(module.order);
    const identity = `${label}/${file}`;
    if (clash !== undefined) {
      throw new Error(
        `Provider modules "${clash}" and "${identity}" both declare order ${module.order}; ` +
          `orders must be unique because the lowest one is the default provider`,
      );
    }
    byOrder.set(module.order, identity);
  }

  return found.sort((a, b) => a.module.order - b.module.order).map((f) => f.module);
}

/**
 * Resolved at module load via top-level await, deliberately.
 *
 * The package is ESM, so anything importing this module is evaluated only once
 * this has settled — which lets `Core`'s constructor stay synchronous and read
 * an already-populated list. An async `Core` would propagate all the way up
 * through `PlatformHandler` → `WebPlatformHandler` → `WebServer`'s constructor,
 * and turn every currently-sync `Core` accessor into a promise.
 */
export const providerModules: ProviderModule[] = await discover();
