/**
 * The TV sign-in user code, as the phone types it. Mirrors
 * normalizeUserCode() in auth/deviceLogin.ts: uppercase, drop anything outside
 * the alphabet, regroup into XXXX-XXXX — a phone keyboard produces lowercase
 * and stray spaces constantly, and a code that "doesn't work" because of a
 * space wastes the whole flow.
 *
 * `npm run test:device-login` checks this alphabet against the codes the
 * server actually generates (as it does public/scripts/tv.js's copy).
 */
export const ALPHABET = "ACDEFGHJKMNPQRTUVWXY3467";

export function normalizeUserCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .split("")
    .filter((ch) => ALPHABET.includes(ch))
    .join("")
    .slice(0, 8);

  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += 4) groups.push(cleaned.slice(i, i + 4));
  return groups.join("-");
}
