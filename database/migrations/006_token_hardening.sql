-- ============================================================
-- 006_token_hardening.sql
--
-- Two unrelated-looking changes that are the same fix: a secret this server
-- hands out should not be usable by whoever later reads the row it is stored
-- in, and a secret that comes back after it was retired should be treated as
-- evidence rather than as an ordinary expired session.
-- ============================================================

-- ── Refresh-token families ───────────────────────────────────
--
-- Rotation revokes a refresh token the moment its successor is minted, so a
-- token presented after that is one of two things: a client retrying a call
-- whose answer it never received (handled by the 60-second grace window in
-- AccountService), or a copy someone else is holding. Until now both were
-- answered the same way — reject this one token, leave everything else alone —
-- which means a stolen token that had already been rotated kept its *own*
-- descendant session alive indefinitely, and nothing anywhere recorded that
-- two parties were using the same chain.
--
-- A family id ties a login to every token rotated out of it, so the reuse can
-- be answered proportionally: kill that chain, leave the user's other devices
-- signed in. Revoking every session on the account instead would turn one
-- laptop that lost a response into a forced sign-out on the user's phone, TV
-- and tablet, which is why that was rejected as the response here.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS family_id UUID;

-- Tokens already in flight predate the column and have no chain recorded.
-- Giving each its own family keeps them valid and simply means the first
-- rotation after this deploy starts their chain.
UPDATE refresh_tokens SET family_id = gen_random_uuid() WHERE family_id IS NULL;

ALTER TABLE refresh_tokens ALTER COLUMN family_id SET DEFAULT gen_random_uuid();
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ── Hashed reset / verification tokens ───────────────────────
--
-- These columns held the token exactly as it was mailed out, unlike
-- refresh_tokens.token_hash, which has always stored a SHA-256 digest. Anyone
-- who could read the users table — a backup, a replica, an unrelated read
-- primitive — could therefore mint a password reset for any account with one
-- in flight. From this migration on the application stores the digest and
-- hashes what a caller presents before looking it up.
--
-- Tokens already in flight are cleared rather than migrated: they are
-- plaintext, so leaving them would defeat the change, and rehashing them in
-- SQL needs pgcrypto, which an install may not have. The remedy is a fresh
-- link from POST /api/auth/verify-email/resend or the password-reset form, and
-- both are one click for the user.
UPDATE users
   SET verification_token     = NULL,
       verification_token_exp = NULL
 WHERE verification_token IS NOT NULL;

UPDATE users
   SET reset_token     = NULL,
       reset_token_exp = NULL
 WHERE reset_token IS NOT NULL;
