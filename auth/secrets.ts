import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for the shared secrets that authenticate the
 * host-side callers (`power-controller/`, `updater/`) and peer installs
 * (`/api/sync`).
 *
 * `a !== b` on a string returns as soon as two bytes differ, which leaks a
 * prefix one request at a time. Hashing both sides first is what makes the
 * comparison safe to do at all: `timingSafeEqual` throws on a length mismatch,
 * so feeding it the raw strings would leak the expected length instead — the
 * digests are always 32 bytes whatever went in.
 */
export function secretMatches(candidate: unknown, expected: unknown): boolean {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  if (expected.length === 0) return false;

  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(expected).digest()
  );
}
