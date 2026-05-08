/**
 * GET /api/admin/encryption-health — SUPER_ADMIN-only encryption posture probe.
 *
 * Returns:
 *   - `activeKeyVersion` — the version every new write goes out under.
 *   - `knownVersions`    — every `FIELD_ENCRYPTION_KEY_V<n>` the env defines
 *                          (so the rotation script knows which keys it can
 *                          read).
 *   - `isDevFallback`    — `true` iff we're running on the deterministic dev
 *                          key (NOT a production posture).
 *   - `probeOk`          — round-trip a constant test string through encrypt
 *                          + decrypt to surface "the active key actually
 *                          works on this node".
 *   - `counts`           — per-encrypted-column tally split by version
 *                          prefix, with `plaintext` + `null` buckets too.
 *                          The rotation page uses this to confirm "0 rows
 *                          remain under v1" before dropping the old key.
 *
 * Every successful response also writes an `ENCRYPTION_HEALTH_CHECKED` audit
 * row — peeking at posture is a privileged operation in its own right.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";
import {
  decryptField,
  encryptField,
  getActiveKeyVersion,
  getKnownKeyVersions,
} from "@/server/crypto/field-cipher";

interface ColumnCounts {
  total: number;
  null: number;
  plaintext: number;
  /** counts keyed by version prefix, e.g. { v1: 100, v2: 23 } */
  byVersion: Record<string, number>;
}

interface HealthResponse {
  activeKeyVersion: string;
  knownVersions: string[];
  isDevFallback: boolean;
  probeOk: boolean;
  probeError: string | null;
  counts: Record<string, ColumnCounts>;
  generatedAt: string;
}

async function requireSuper(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  return { ok: true, userId: session.user.id };
}

/**
 * Tally rows for one column. We do this in raw SQL because the alternative
 * (`findMany` over millions of rows just to count prefixes) doesn't scale.
 *
 * Each `total` query is a single `COUNT(*)`; `byVersion` uses `LEFT(col, 3)`
 * to peel the `v<n>:` prefix and groups on it. Postgres can index-only-scan
 * this if needed, but even a seq-scan over a few hundred-thousand rows is
 * sub-second and this endpoint is rarely hit.
 */
async function countColumn(
  table: "Patient" | "MedicalCase" | "Prescription",
  column: "passport" | "notes" | "soapDraft",
): Promise<ColumnCounts> {
  // Identifiers are interpolated, not parameterised — they come from a closed
  // enum above, never user input. Postgres requires double-quoted identifiers
  // for our PascalCase model names.
  const tableQ = `"${table}"`;
  const colQ = `"${column}"`;

  const [{ total }] = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS total FROM ${tableQ}`,
  )) as { total: number }[];

  const [{ nulls }] = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS nulls FROM ${tableQ} WHERE ${colQ} IS NULL`,
  )) as { nulls: number }[];

  // SUBSTRING with a regex grabs the `v<n>:` prefix when present, NULL when
  // the value is plaintext or NULL. We coalesce to '__plain__' so plaintext
  // rows show up in a single bucket.
  const prefixRows = (await prisma.$queryRawUnsafe(
    `SELECT
       COALESCE(SUBSTRING(${colQ} FROM '^v[0-9]+(?=:)'), '__plain__') AS prefix,
       COUNT(*)::int AS n
     FROM ${tableQ}
     WHERE ${colQ} IS NOT NULL
     GROUP BY prefix`,
  )) as { prefix: string; n: number }[];

  const byVersion: Record<string, number> = {};
  let plaintext = 0;
  for (const r of prefixRows) {
    if (r.prefix === "__plain__") {
      plaintext = r.n;
    } else {
      byVersion[r.prefix] = r.n;
    }
  }

  return {
    total,
    null: nulls,
    plaintext,
    byVersion,
  };
}

function probeRoundTrip(): { ok: boolean; error: string | null } {
  try {
    // The probe string is constant on purpose — the same plaintext encrypts
    // to a different ciphertext every call (random IV), and the round-trip
    // confirms the active key both encrypts AND decrypts cleanly on this node.
    const sentinel = "encryption-health-probe-" + new Date().toISOString();
    const enc = encryptField(sentinel);
    const dec = decryptField(enc);
    if (dec !== sentinel) {
      return { ok: false, error: "round-trip mismatch" };
    }
    return { ok: true, error: null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
    };
  }
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;

  return runWithTenant(
    { kind: "SUPER_ADMIN", userId: gate.userId },
    async () => {
      const probe = probeRoundTrip();

      // Counts run in parallel — independent SELECTs on three tables.
      const [patientPassport, patientNotes, soapDraft, rxNotes] =
        await Promise.all([
          countColumn("Patient", "passport"),
          countColumn("Patient", "notes"),
          countColumn("MedicalCase", "soapDraft"),
          countColumn("Prescription", "notes"),
        ]);

      const counts: Record<string, ColumnCounts> = {
        "patient.passport": patientPassport,
        "patient.notes": patientNotes,
        "medical_case.soapDraft": soapDraft,
        "prescription.notes": rxNotes,
      };

      const activeKeyVersion = getActiveKeyVersion();
      const knownVersions = getKnownKeyVersions();
      const isDevFallback =
        process.env.NODE_ENV !== "production" &&
        !process.env.FIELD_ENCRYPTION_KEY &&
        !knownVersions.some((v) => process.env[`FIELD_ENCRYPTION_KEY_${v.toUpperCase()}`]);

      const body: HealthResponse = {
        activeKeyVersion,
        knownVersions,
        isDevFallback,
        probeOk: probe.ok,
        probeError: probe.error,
        counts,
        generatedAt: new Date().toISOString(),
      };

      // Audit-of-the-audit. Failures are logged but don't break the response —
      // an audit-write hiccup shouldn't lock the admin out of seeing posture.
      try {
        await prisma.auditLog.create({
          data: {
            clinicId: null,
            actorId: gate.userId,
            actorRole: "SUPER_ADMIN",
            actorLabel: "platform",
            action: AUDIT_ACTION.ENCRYPTION_HEALTH_CHECKED,
            entityType: "EncryptionHealth",
            entityId: null,
            meta: {
              activeKeyVersion,
              knownVersions,
              probeOk: probe.ok,
              counts: Object.fromEntries(
                Object.entries(counts).map(([k, v]) => [
                  k,
                  {
                    total: v.total,
                    null: v.null,
                    plaintext: v.plaintext,
                    byVersion: v.byVersion,
                  },
                ]),
              ),
            } as never,
            ip:
              request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
              request.headers.get("x-real-ip") ??
              null,
            userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
          },
        });
      } catch (e) {
        console.error("[encryption-health] audit insert failed", e);
      }

      return ok(body);
    },
  );
}
