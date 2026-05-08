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
4. Backfill existing rows:
   ```bash
   FIELD_ENCRYPTION_KEY=<KEY> \
   DATABASE_URL=… \
   tsx scripts/encrypt-existing-pii.ts
   ```
   Use `--dry-run` first if you want to preview the per-table counts.
   Re-running is safe — already-encrypted rows are skipped.
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
3. After rotation, **also rotate every other secret that lived next to the
   compromised key**: `AUTH_SECRET`, `APP_SECRET`, MinIO credentials,
   Telegram bot token. They share the same blast radius.
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
- New writes still work (a new key gets generated as v1).
- Old encrypted rows return ciphertext from the read path; the cipher-fields
  hydrators will throw on decrypt and the API will surface the error. Plan
  to scrub those rows (replace with a placeholder marker, or hard-delete them)
  before users hit them.

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
