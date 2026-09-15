import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The TV sign-in ("device") flow.
 *
 * Android TV devices generally ship with no browser and no handler for `https`
 * ACTION_VIEW at all, so the app's normal OAuth path — hand a consent URL to a
 * Custom Tab and wait for `streamio://auth` — cannot start: the launch throws
 * ActivityNotFoundException and the button looks broken. The same is true of
 * any headless-ish client, which is why the shape here is the one YouTube and
 * Netflix use on the same hardware.
 *
 * Two secrets, deliberately asymmetric:
 *
 *   - the **user code** is short and legible from three metres. It is the only
 *     thing shown on the television, and it is *not* bearer material: knowing
 *     it lets you approve a pairing, never collect one.
 *   - the **device code** is long, random, and never leaves the TV. It is what
 *     the app proves to collect the tokens, so a bystander who reads the user
 *     code off the screen still cannot claim the session.
 *
 * The record lives in Redis under the user code, expires on its own, and is
 * burned the moment it is redeemed.
 */

/** How long an unclaimed code stays good. Long enough to find your phone. */
export const DEVICE_CODE_TTL_SECONDS = 10 * 60;

/**
 * How long an *approved* record survives before it is redeemed.
 *
 * Shorter than the pending TTL on purpose: once a real user has approved it,
 * the record is worth a session to whoever holds the device code, and the TV
 * is polling every few seconds anyway. It bounds the window in which a stolen
 * device code is worth anything.
 */
export const DEVICE_APPROVED_TTL_SECONDS = 2 * 60;

/** What we ask the app to wait between polls. */
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

/**
 * Unambiguous on a television: no O/0, I/1/L, S/5, Z/2, B/8. Someone is going
 * to read this off a screen across a room and type it on a phone, and a code
 * that needs a second attempt is a code that reads as broken.
 */
const USER_CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY3467";
const USER_CODE_GROUPS = 2;
const USER_CODE_GROUP_SIZE = 4;

export type DeviceLoginStatus = "pending" | "approved";

export interface DeviceLoginRecord {
  /** SHA-256 of the device code. The code itself is never stored. */
  deviceCodeHash: string;
  status: DeviceLoginStatus;
  /** Set once a signed-in browser has approved the pairing. */
  userId: string | null;
  /** For the approval page, so the user can see what they're signing in. */
  label: string | null;
}

export function deviceKey(userCode: string): string {
  return `auth:device:${userCode}`;
}

const USER_CODE_LENGTH = USER_CODE_GROUPS * USER_CODE_GROUP_SIZE;

/**
 * Largest multiple of the alphabet size that still fits in a byte — 240 for
 * 24 letters. Bytes at or above it are discarded rather than folded in.
 *
 * `randomBytes()[i] % 24` is not uniform: 256 isn't a multiple of 24, so the
 * leftover values 240-255 land on the first sixteen letters a second time and
 * make them ~50% likelier than the last eight. That costs real entropy — the
 * 24^8 the comment below claims becomes noticeably less — and the whole point
 * of a short code that is only ever guarded by "it expires in ten minutes" is
 * that guessing it stays expensive.
 */
const USER_CODE_BYTE_CEILING = 256 - (256 % USER_CODE_ALPHABET.length);

/**
 * `K7RQ-4M3P`. Roughly 24^8 ≈ 1.1e11 possibilities, narrowed by however many
 * codes are live at once — which is why claiming one still requires a signed-in
 * session and redeeming one still requires the device code.
 */
export function generateUserCode(): string {
  let out = "";
  let taken = 0;

  // Rejection sampling. About 6% of bytes are thrown away, so drawing a full
  // code's worth per round means a second round is the rare case rather than
  // the norm, and the loop always terminates on the next draw.
  while (taken < USER_CODE_LENGTH) {
    for (const byte of randomBytes(USER_CODE_LENGTH)) {
      if (byte >= USER_CODE_BYTE_CEILING) continue;
      if (taken > 0 && taken % USER_CODE_GROUP_SIZE === 0) out += "-";
      out += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
      if (++taken === USER_CODE_LENGTH) break;
    }
  }

  return out;
}

export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Accepts what someone actually types: lowercase, spaces, a missing or extra
 * dash. Anything outside the alphabet is dropped rather than rejected, so a
 * pasted code with a stray character still resolves.
 */
export function normalizeUserCode(input: string): string {
  const cleaned = input
    .toUpperCase()
    .split("")
    .filter((ch) => USER_CODE_ALPHABET.includes(ch))
    .join("");

  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += USER_CODE_GROUP_SIZE) {
    groups.push(cleaned.slice(i, i + USER_CODE_GROUP_SIZE));
  }

  return groups.join("-");
}

/** Constant-time, so a poller can't walk the hash out of the timing. */
export function deviceCodeMatches(candidate: string, expectedHash: string): boolean {
  const a = Buffer.from(hashDeviceCode(candidate), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
