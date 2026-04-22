#!/usr/bin/env tsx
/**
 * Migrate legacy Phase-4 `ProviderConnection.secretCipher` values (raw base64)
 * to the AES-256-GCM `v1:` format produced by `src/server/crypto/secrets.ts`.
 *
 * Flow per row:
 *   - Attempt `decrypt(secretCipher)`. If it succeeds → already v1, skip.
 *   - On failure, assume the legacy value is a base64 blob. Decode it.
 *     If decoded bytes look like a plausible UTF-8 string (no NULs in the
 *     first 32 bytes, reasonable length), re-encrypt via `encrypt(plaintext)`
 *     and update the row.
 *   - If decoding fails or yields binary garbage, print a warning and leave
 *     the row alone.
 *
 * Idempotent: running twice is a no-op for rows already in `v1:` format.
 *
 * Usage:
 *   cd /opt/medbook
 *   docker compose exec app npx tsx ops/migrate-secrets.ts          # dry-run
 *   docker compose exec app npx tsx ops/migrate-secrets.ts --apply  # do it
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { decrypt, encrypt } from "@/server/crypto/secrets";

type Row = {
  id: string;
  clinicId: string;
  kind: string;
  label: string | null;
  secretCipher: string;
};

function looksLikeAscii(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 64));
  for (const b of sample) {
    // Allow tab/newline/carriage-return and printable ASCII.
    if (b === 0) return false;
    if (b !== 9 && b !== 10 && b !== 13 && (b < 0x20 || b > 0x7e)) return false;
  }
  return true;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await runWithTenant({ kind: "SYSTEM" }, async () => {
    return prisma.providerConnection.findMany({
      select: {
        id: true,
        clinicId: true,
        kind: true,
        label: true,
        secretCipher: true,
      },
    }) as unknown as Promise<Row[]>;
  });

  let ok = 0;
  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    const label = `${row.clinicId}/${row.kind}${row.label ? ":" + row.label : ""}`;
    try {
      // Already v1 — nothing to do.
      decrypt(row.secretCipher);
      ok++;
      continue;
    } catch {
      // fall through
    }

    // Try to treat as legacy base64.
    let plaintext: string | null = null;
    try {
      const buf = Buffer.from(row.secretCipher, "base64");
      if (looksLikeAscii(buf)) {
        plaintext = buf.toString("utf8");
      }
    } catch {
      // not base64
    }

    if (!plaintext) {
      console.warn(`[migrate-secrets] ${label} — unrecognised format; skipping`);
      failed++;
      continue;
    }

    const newCipher = encrypt(plaintext);
    if (apply) {
      await runWithTenant({ kind: "SYSTEM" }, async () => {
        await prisma.providerConnection.update({
          where: { id: row.id },
          data: { secretCipher: newCipher },
        });
      });
      console.info(`[migrate-secrets] ${label} — migrated`);
    } else {
      console.info(`[migrate-secrets] ${label} — would migrate (dry-run)`);
    }
    migrated++;
  }

  console.info(
    `[migrate-secrets] summary: ok=${ok} migrated=${migrated} failed=${failed} total=${rows.length}` +
      (apply ? "" : "  (dry-run — pass --apply to write)"),
  );

  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error("[migrate-secrets] fatal:", e);
  process.exit(1);
});
