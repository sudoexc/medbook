# Encryption-Key Rotation — runbook

## What is encrypted

Phase 17 Wave 4 introduced **app-level encryption-at-rest** for a tight set of
highly-sensitive PII fields. Encryption happens in the Node.js app via
AES-256-GCM at the Prisma boundary; ciphertext lands in Postgres as opaque
strings. The DB never sees a plaintext key.

| Table          | Column      | Why encrypted                                       |
| -------------- | ----------- | --------------------------------------------------- |
| `Patient`      | `passport`  | UZ identity document; legal-grade PII.              |
| `Patient`      | `notes`     | Free-text PII written by reception/doctor.          |
| `MedicalCase`  | `soapDraft` | Voice-transcribed clinical SOAP markdown.           |
| `Prescription` | `notes`     | Doctor's free-text rationale on a prescription.     |

Indexed / search-required fields (`fullName`, `phoneNormalized`, `email`,
`telegramId`, `birthDate`) are deliberately **not** encrypted — encrypting
them would require a blind-index (HMAC) layer for `contains` / `equals` lookups,
and that's a separate architecture decision.

The wire format is `v<n>:<iv_b64>:<tag_b64>:<ct_b64>`. Every cell carries the
key version it was encrypted under, so a multi-version transition is safe.

---

## Why app-level (not pgcrypto)

We considered `pgcrypto`'s `pgp_sym_encrypt` / `pgp_sym_decrypt` and chose
not to use it. Recorded for posterity:

- **Key would have to live where Postgres can read it** — either in
  `current_setting('app.key')` (means handing the key to every connection) or
  via an extension that pulls it from the OS env. Both compromises that
  app-level avoids: with app-level, a Postgres dump captured *without* the
  Node env is useless to the attacker.
- **Every read query would need a wrapper.** Our Prisma client has a custom
  output (`src/generated/prisma/client`) and a tenant-scoping extension. Pushing
  `pgp_sym_decrypt` into the SELECT path means raw SQL or fragile generated-
  client patches.
- **No SELECT-time CPU on the DB.** The encryption tax is on the Node side,
  where we can scale horizontally.

The trade-off: we cannot do `WHERE passport ILIKE '%…%'` against encrypted
rows. The roadmap accepts this — passport search is rare and the few callsites
that need it can either use `Patient.fullName` (still plaintext) or iterate.

---

## Generating a new key

```bash
openssl rand -base64 32
```

Output is 44 chars. Store it as **base64 of the raw 32 bytes** — the cipher
helper `decodeKey` rejects anything that doesn't decode to exactly 32 bytes.

---

## Initial setup (first deploy of Wave 4)

1. Generate a key:
   ```bash
   KEY=$(openssl rand -base64 32)
   ```
2. Set it on every node that runs the Next app, the queue worker, or the
   backfill script — the same value, exactly once:
   ```
   FIELD_ENCRYPTION_KEY=<KEY>
   ```
   (Legacy alias; `FIELD_ENCRYPTION_KEY_V1` works identically.)
3. Deploy the new build. New writes immediately go out as `v1:…`.
4. Backfill existing rows **inside the worker container**, where the key is
   the app's own (from the server's `.env`), never from a laptop with a key
   typed on the command line:
   ```bash
   docker compose exec worker npx tsx scripts/encrypt-existing-pii.ts --dry-run
   docker compose exec worker npx tsx scripts/encrypt-existing-pii.ts
   ```
   Re-running is safe — already-encrypted rows are skipped.

   Before the first write the script proves the key is the app's (audit
   G2-11): it decrypts the newest existing ciphertext of every column it
   writes and stops, writing nothing, on the first failure. It refuses the
   deterministic dev fallback key (no `FIELD_ENCRYPTION_KEY` set) anywhere
   but a local development database; it used to print a WARNING and encrypt
   real data under that public key. On a non-local database with no
   ciphertext at all yet there is nothing to compare against: after checking
   the key by hand, add `--first-run`. The run prints a 12-character key
   fingerprint; two runs with the same fingerprint used the same key.
   `scripts/encrypt-auth-secrets.ts` (TOTP secrets, clinic bot tokens under
   APP_SECRET) follows the same rules and reads a `.env` only when named
   with `--env-file=`.
5. Visit `/admin/encryption-health` and confirm:
   - `activeKeyVersion: v1`
   - All "rows-by-version" counts are under `v1` (no `null` / "plaintext"
     remaining).
   - "Probe round-trip" reads `OK`.

---

## Quarterly rotation

We rotate quarterly (or on-demand if a key is suspected of compromise — see
below). The cipher format supports running multiple key versions in parallel,
so the rotation is **zero-downtime**.

### Step-by-step

1. **Add the new key** alongside the existing one. Do NOT remove the old one.
   ```
   FIELD_ENCRYPTION_KEY_V1=<old-key>
   FIELD_ENCRYPTION_KEY_V2=<new-key>
   ```
   (If the old key is currently set as `FIELD_ENCRYPTION_KEY`, rename it to
   `FIELD_ENCRYPTION_KEY_V1` in the same edit.)

2. **Restart all app + worker processes.** From this moment:
   - New encrypts go out as `v2:…` (highest numeric suffix wins).
   - Old `v1:…` rows still decrypt fine — the cipher reads the prefix and
     picks the matching key from the env.

3. **Run the rotation script.** It walks every encrypted column and
   re-encrypts any cell whose prefix doesn't match the active version.
   ```bash
   FIELD_ENCRYPTION_KEY_V1=<old-key> \
   FIELD_ENCRYPTION_KEY_V2=<new-key> \
   DATABASE_URL=… \
   tsx scripts/rotate-encryption-key.ts
   ```
   Uses cursor pagination + 200-row transactional batches. Re-running is
   idempotent: already-active rows are skipped.

4. **Verify in `/admin/encryption-health`:**
   - `activeKeyVersion: v2`
   - "rows-by-version" shows `v1: 0` for every column.
   - Probe round-trip still `OK`.

5. **Drop the old key.** Remove `FIELD_ENCRYPTION_KEY_V1` from the env, deploy
   one more time (the restart is the actual cutover). Now the old key is gone
   from disk; even if the DB is leaked the attacker has nothing.

### Common pitfall

> "I removed `FIELD_ENCRYPTION_KEY_V1` after step 2 because the new key was
> already there."

Don't. Step 3 needs the old key to *decrypt* the existing `v1:…` rows so it
can re-encrypt them under v2. Pull the old key only after the rotation script
reports zero v1 rows.

---

## Key-compromise procedure

If we have reason to believe `FIELD_ENCRYPTION_KEY_V<n>` has leaked
(disclosed env file, ex-employee with prod access, suspect deploy, etc.):

1. **Treat it as urgent — every minute the DB is alive on disk, an attacker
   with the key can read PHI from a stolen dump.**
2. Generate `FIELD_ENCRYPTION_KEY_V<n+1>` and follow the rotation steps above
   on the same calendar day.
3. After rotation, **review every other secret that lived next to the
   compromised key** (same `.env`, same blast radius), each with its own
   procedure, never by simply typing a new value:
   - MinIO credentials and the Telegram bot token are replaced at their
     source (MinIO console; BotFather `/revoke`, then the new token through
     «Сменить бота» in the clinic settings).
   - `AUTH_SECRET` and `APP_SECRET` are **not** field-encryption keys: they
     have no version tag and no re-encryption script, so changing them in
     place breaks 2FA sign-in, the clinic bot and the Mini App for everyone
     at once (audit G2-04). Follow
     [AUTH_SECRET and APP_SECRET](#auth_secret-and-app_secret) below.
4. File an incident note in `/admin/audit` (manual entry via the audit API)
   with the timestamp, the affected key version, and the rotation result.
5. If law-enforcement notification is required (depends on jurisdiction +
   what was actually exposed), the patient-row count of leaked encrypted
   rows is `SELECT COUNT(*) FROM "Patient"` minus rows that were rotated
   *before* the leak. Check the rotation script's start time vs the leak
   window.

---

## Recovery — "I lost the key"

The data under that key is **unrecoverable.** AES-256-GCM with a 256-bit key
has no shortcut. This is the trade-off you accept by encrypting:

- A DB dump alone is useless to an attacker — good.
- A DB dump alone is useless to *us*, too, if we lose the key.

Practical mitigations:

1. **Store the key in the secret manager that backs the deploy** (not just
   in a developer's `.env`). For self-hosted Vercel/VPS that means
   1Password / a sealed-secret store / a hardware token. The key should be
   reproducible on a fresh deploy without any single human's laptop.
2. **Print the key on paper, sealed envelope, locked drawer.** Cheap
   insurance. Paper doesn't get ransomwared.
3. **Keep a "previous key" in the secret store for at least 90 days after a
   rotation.** This is your safety net if the rotation script silently
   missed a row. After 90 days of clean health-check reports you can drop it.

If the key truly is gone:
- Nothing is generated for you. In production the app **refuses to boot**
  when no `FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_KEY_V<n>` is set
  (`field-cipher.ts` fails closed rather than encrypting under the public
  dev key), and the backfill / rotation scripts refuse the dev fallback too.
- Issue a new key under a **new version number**, one above the highest
  version that ever existed (`v<n+1>`), never under the lost version's
  label. Cells keep the prefix they were written with: a new key filed as
  `FIELD_ENCRYPTION_KEY_V1` would make the old `v1:` cells fail the GCM tag
  check with a confusing «wrong key» error, and the slot the old key belongs
  to would be taken if the old key ever turns up again (a backup, the sealed
  envelope). With the new key as `v<n+1>`, new writes go out as `v<n+1>:`,
  and every unreadable cell is exactly the one carrying the lost prefix.
- Reads of the unreadable cells do not crash the page: the read boundary
  shows the field as empty and writes one `ENCRYPTION_DECRYPT_FAILED` audit
  row per row, field and hour (`src/server/crypto/decrypt-failure.ts`).
  `/admin/encryption-health` counts them under the lost version.
- Do not run `rotate-encryption-key.ts` while the lost version's cells are
  still in the table: it cannot decrypt them and reports each as an error.
  Replace them first, column by column (the columns are the ones the health
  page lists), for example for `Patient.passport` lost under `v1`:
  ```sql
  -- How many, before anything changes:
  SELECT COUNT(*) FROM "Patient" WHERE "passport" LIKE 'v1:%';
  -- The value is gone; NULL means «not recorded», which the card shows as empty:
  UPDATE "Patient" SET "passport" = NULL WHERE "passport" LIKE 'v1:%';
  ```
  Free-text columns (`notes`, `soapDraft`) can be set to NULL the same way.
  Tell the clinic which records lost which field (the counts above), so
  staff re-enter what matters from paper.
- Add the old key back as `FIELD_ENCRYPTION_KEY_V<lost>` if it is ever
  found: any cell not yet replaced decrypts again with no other change.

---

## AUTH_SECRET and APP_SECRET

Neither secret is part of the quarterly rotation above, and neither is
changed «while we are at it» during a field-key rotation or an incident
(audit G2-04). Each is a single key with no version tag: the moment a new
value is set, it applies to every stored value and every link already
handed out.

| Secret | What it keys | What breaks the moment it changes |
| ------ | ------------ | --------------------------------- |
| `AUTH_SECRET` | NextAuth session JWTs. When `APP_SECRET` is **not** set, also everything in the next row (the app falls back to `AUTH_SECRET`). | Every staff session ends; everyone signs in again. If `APP_SECRET` is unset, everything in the next row breaks as well. |
| `APP_SECRET` | AES-256-GCM of `User.totpSecret` / `pendingTotpSecret`, `Clinic.tgBotToken` and `ProviderConnection.secretCipher` (`src/server/crypto/secrets.ts`: one key, only `v1`, no previous-key fallback). HMAC of the admin clinic-override cookie, the 2FA-pending cookie and the public capability links (`src/server/crypto/app-hmac.ts`: queue ticket QR links, board row keys, document upload receipts, Mini App file, calendar and event-stream links). | Nobody with 2FA can sign in, SUPER_ADMIN included (`readTotpSecret` throws on the old seed at login). The clinic bot goes silent and the Mini App rejects every patient (`initData` is verified with the bot token, which no longer decrypts). Integration secrets stop decrypting. Tickets printed and Mini App links issued before the change stop opening. There is no re-encryption script: the old values come back only by putting the old `APP_SECRET` back. |

### First: make sure `APP_SECRET` is set on its own

```bash
docker compose exec app sh -c 'test -n "$APP_SECRET" && echo set || echo MISSING'
```

`MISSING` means the app derives every key in the table from `AUTH_SECRET`,
so changing `AUTH_SECRET` would break all of it. Pin it first: in the
server's `.env` set `APP_SECRET` to the **current** `AUTH_SECRET` value, byte
for byte, then `docker compose up -d app worker`, and check that a user with
2FA can sign in and that the Mini App opens. Nothing changes for anyone (the
derived keys are the same); from now on `AUTH_SECRET` can change on its own.

### Changing `AUTH_SECRET` (a session or the `.env` may have leaked)

1. Pin `APP_SECRET` as above, if it is not set yet.
2. `openssl rand -base64 32` (32 random bytes).
3. Pick a quiet moment (before the clinic opens or after the last visit) and
   tell reception that everyone will be signed out.
4. Replace `AUTH_SECRET` in the server's `.env`, then
   `docker compose up -d app worker`.
5. Everyone signs in again with password and 2FA. Patients notice nothing:
   the bot and the Mini App do not use NextAuth.

### `APP_SECRET`: never changed in place

Rotation of `APP_SECRET` is not supported: `secrets.ts` knows one key and
one version tag (`docs/architecture/SECURITY.md`, open risk 9). If it may have
leaked, think about what it gives an attacker: forging the cookies and links
in the table, and, together with a database dump, reading the bot token,
the TOTP seeds and the integration secrets. Re-encrypting those values under
a new key would not un-leak them, so the response is to **replace the values
themselves**, and only then the key, in one planned window before the clinic
opens:

1. Tell reception: the bot is down for the window, tickets printed earlier
   will not scan, and staff with 2FA set it up again at their next sign-in.
2. Take stock (keep the numbers for the incident note):
   ```sql
   SELECT COUNT(*) FROM "User" WHERE "totpSecret" IS NOT NULL OR "pendingTotpSecret" IS NOT NULL;
   SELECT "slug", "tgBotUsername" FROM "Clinic" WHERE "tgBotToken" IS NOT NULL;
   SELECT "clinicId", "kind", "label" FROM "ProviderConnection";
   ```
3. Revoke every clinic bot token in BotFather (`/revoke`) and keep the new
   tokens at hand.
4. Clear what the new key could never decrypt, in one transaction (this is
   exactly what «Сбросить 2FA» writes for one user, for all of them, plus
   the bot tokens):
   ```sql
   BEGIN;
   UPDATE "User" SET "totpSecret" = NULL, "totpEnabledAt" = NULL,
     "recoveryCodesHash" = '{}', "pendingTotpSecret" = NULL,
     "pendingTotpExpiresAt" = NULL
   WHERE "totpSecret" IS NOT NULL OR "pendingTotpSecret" IS NOT NULL;
   UPDATE "Clinic" SET "tgBotToken" = NULL WHERE "tgBotToken" IS NOT NULL;
   COMMIT;
   ```
5. Set the new `APP_SECRET` (`openssl rand -base64 32`) in the server's
   `.env`, then `docker compose up -d app worker`.
6. Each clinic admin signs in (no 2FA prompt now), connects the bot again
   with the new token (the Telegram card in the integrations settings
   opens the connect wizard), and re-saves every
   integration from step 2 with a fresh secret from the provider's side.
   ADMIN and SUPER_ADMIN (and everyone in a clinic with «2FA для всех»)
   are sent to 2FA enrolment right after signing in; other users who had
   2FA turn it on again in their security settings.
7. Check: a 2FA sign-in works, the bot answers `/start`, the Mini App opens,
   a new ticket's QR opens.

Never skip step 4 and change the key alone: the old ciphertexts stay in the
table, every 2FA sign-in fails with an error instead of asking to enrol, and
no admin can get in to reconnect the bot.

---

## Health-check route

`GET /api/admin/encryption-health` (SUPER_ADMIN only) returns:

```json
{
  "activeKeyVersion": "v1",
  "knownVersions": ["v1"],
  "isDevFallback": false,
  "probeOk": true,
  "counts": {
    "patient.passport":   { "v1": 1234, "plaintext": 0, "null": 56 },
    "patient.notes":      { "v1": 800,  "plaintext": 0, "null": 490 },
    "medical_case.soapDraft": { "v1": 220, "plaintext": 0, "null": 130 },
    "prescription.notes": { "v1": 95,  "plaintext": 0, "null": 22 }
  }
}
```

The page at `/admin/encryption-health` renders this. Every successful hit also
emits an `ENCRYPTION_HEALTH_CHECKED` audit row — peeking at encryption posture
is a privileged operation in its own right.

---

## Quick reference

| Task                       | Command                                                    |
| -------------------------- | ---------------------------------------------------------- |
| Generate a key             | `openssl rand -base64 32`                                  |
| Backfill plaintext rows    | `tsx scripts/encrypt-existing-pii.ts [--dry-run]`          |
| Rotate to a new key        | `tsx scripts/rotate-encryption-key.ts [--dry-run]`         |
| Inspect posture            | `GET /api/admin/encryption-health` or `/admin/encryption-health` |
| Limit backfill to one tbl  | `tsx scripts/encrypt-existing-pii.ts --table=patient`      |
