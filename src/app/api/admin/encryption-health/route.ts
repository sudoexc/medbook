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
 * A successful response also writes an `ENCRYPTION_HEALTH_CHECKED` audit
 * row — peeking at posture is a privileged operation in its own right — but
 * at most one per SUPER_ADMIN per `AUDIT_THROTTLE_MS` (audit G5-15). The page
 * refetched every minute and each refetch wrote a row: an open tab buried the
 * real platform events in /admin/audit under ~60 identical rows an hour. The
 * page no longer polls either (the «Обновить» button stays), and each column
 * is tallied in one scan instead of three.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok } from "@/server/http";
import { requireSuperAdmin } from "@/server/platform/handler";
import {
  decryptField,
  encryptField,
  getActiveKeyVersion,
  getKnownKeyVersions,
} from "@/server/crypto/field-cipher";
import { clientIpForAudit } from "@/lib/client-ip";

/** One ENCRYPTION_HEALTH_CHECKED row per SUPER_ADMIN in this window. */
const AUDIT_THROTTLE_MS = 15 * 60 * 1000;

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

/**
 * Tally rows for one column. We do this in raw SQL because the alternative
 * (`findMany` over millions of rows just to count prefixes) doesn't scale.
 *
 * One scan per column (audit G5-15; it used to be three: COUNT(*), COUNT of
 * NULLs and the prefix GROUP BY): every row lands in one bucket, `__null__`,
 * `__plain__` or its `v<n>` prefix, and the total is their sum.
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

  // SUBSTRING with a regex grabs the `v<n>:` prefix when present, NULL when
  // the value is plaintext. We coalesce to '__plain__' so plaintext rows show
  // up in a single bucket.
  const prefixRows = (await prisma.$queryRawUnsafe(
    `SELECT
       CASE WHEN ${colQ} IS NULL THEN '__null__'
            ELSE COALESCE(SUBSTRING(${colQ} FROM '^v[0-9]+(?=:)'), '__plain__')
       END AS prefix,
       COUNT(*)::int AS n
     FROM ${tableQ}
     GROUP BY 1`,
  )) as { prefix: string; n: number }[];

  const byVersion: Record<string, number> = {};
  let total = 0;
  let nulls = 0;
  let plaintext = 0;
  for (const r of prefixRows) {
    total += r.n;
    if (r.prefix === "__null__") {
      nulls = r.n;
    } else if (r.prefix === "__plain__") {
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
  const gate = await requireSuperAdmin();
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
        // A look within the throttle window is already on record. A failing
        // probe is always recorded: that is news, not a repeat.
        const recent = probe.ok
          ? await prisma.auditLog.findFirst({
              where: {
                actorId: gate.userId,
                action: AUDIT_ACTION.ENCRYPTION_HEALTH_CHECKED,
                createdAt: { gte: new Date(Date.now() - AUDIT_THROTTLE_MS) },
              },
              select: { id: true },
            })
          : null;
        if (!recent) await prisma.auditLog.create({
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
            ip: clientIpForAudit(request),
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
