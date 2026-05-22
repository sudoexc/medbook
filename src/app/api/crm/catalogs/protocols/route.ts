/**
 * /api/crm/catalogs/protocols — clinical protocol lookup (Phase G2).
 *
 * Query by `code` (full ICD-10 code on the visit): we match
 * `diagnosisCodePrefix` as a prefix of the supplied code so e.g. "I10.2"
 * resolves the generic "I10" protocol. Multiple matches sort by prefix
 * length descending (most specific wins), then `sortOrder`.
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

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const hidden = await loadHiddenCodes(clinicId, "PROTOCOL");

    if (!q.code || !q.code.trim()) {
      const all = await prisma.clinicalProtocol.findMany({
        where: { active: true },
        orderBy: [{ diagnosisCodePrefix: "asc" }, { sortOrder: "asc" }],
      });
      // Protocols don't have a stable slug column — overlay rows key by
      // `id` (cuid) instead. Hidden-set semantics are the same.
      const rows = hidden.size > 0 ? all.filter((p) => !hidden.has(p.id)) : all;
      return ok({ rows, total: rows.length });
    }

    const code = q.code.trim().toUpperCase();
    const all = await prisma.clinicalProtocol.findMany({
      where: { active: true },
    });
    const matches = all
      .filter((p) => code.startsWith(p.diagnosisCodePrefix.toUpperCase()))
      .filter((p) => !hidden.has(p.id))
      .sort((a, b) => {
        const lenDiff = b.diagnosisCodePrefix.length - a.diagnosisCodePrefix.length;
        if (lenDiff !== 0) return lenDiff;
        return a.sortOrder - b.sortOrder;
      });

    return ok({ rows: matches, total: matches.length });
  },
);
