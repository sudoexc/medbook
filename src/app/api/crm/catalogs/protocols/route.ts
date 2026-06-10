/**
 * /api/crm/catalogs/protocols — clinical protocol lookup (Phase G2, Ф3 v2).
 *
 * Query by `code` (full ICD-10 code on the visit): we match
 * `diagnosisCodePrefix` as a prefix of the supplied code so e.g. "I10.2"
 * resolves the generic "I10" protocol.
 *
 * Ф3 — three visibility scopes (ClinicalProtocol is in
 * MODELS_WITHOUT_TENANT, so the filter here is explicit and mandatory):
 *   global (clinicId null) + clinic-own (clinicId = mine, doctorId null)
 *   + personal (doctorId = my Doctor row, DOCTOR sessions only).
 * Apply priority: personal → clinic → global, within a scope longest
 * prefix first, then `sortOrder`.
 *
 * Returns an empty array when no protocol exists for the code — the
 * "Применить стандарт" button hides itself.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { loadHiddenCodes } from "@/server/catalog/clinic-overlay";
import { ok, parseQuery } from "@/server/http";
import { z } from "zod";

const QuerySchema = z.object({
  code: z.string().optional(),
});

type ProtocolRow = Awaited<
  ReturnType<typeof prisma.clinicalProtocol.findMany>
>[number];

// personal 0 → clinic 1 → global 2
function scopeRank(p: ProtocolRow): number {
  if (p.doctorId) return 0;
  if (p.clinicId) return 1;
  return 2;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const hidden = await loadHiddenCodes(clinicId, "PROTOCOL");

    // Personal protocols surface only for the owning doctor.
    let myDoctorId: string | null = null;
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      myDoctorId = doctor?.id ?? null;
    }

    const visible = await prisma.clinicalProtocol.findMany({
      where: {
        active: true,
        OR: [
          { clinicId: null, doctorId: null },
          ...(clinicId ? [{ clinicId, doctorId: null }] : []),
          ...(myDoctorId ? [{ doctorId: myDoctorId }] : []),
        ],
      },
      orderBy: [{ diagnosisCodePrefix: "asc" }, { sortOrder: "asc" }],
    });
    // Protocols don't have a stable slug column — overlay rows key by `id`
    // (cuid). The overlay hides global rows only; clinic/personal rows are
    // managed via their own `active` flag.
    const rows =
      hidden.size > 0
        ? visible.filter((p) => p.clinicId !== null || !hidden.has(p.id))
        : visible;

    if (!q.code || !q.code.trim()) {
      return ok({ rows, total: rows.length });
    }

    const code = q.code.trim().toUpperCase();
    const matches = rows
      .filter((p) => code.startsWith(p.diagnosisCodePrefix.toUpperCase()))
      .sort((a, b) => {
        const rankDiff = scopeRank(a) - scopeRank(b);
        if (rankDiff !== 0) return rankDiff;
        const lenDiff = b.diagnosisCodePrefix.length - a.diagnosisCodePrefix.length;
        if (lenDiff !== 0) return lenDiff;
        return a.sortOrder - b.sortOrder;
      });

    return ok({ rows: matches, total: matches.length });
  },
);
