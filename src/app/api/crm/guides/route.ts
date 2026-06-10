/**
 * GET /api/crm/guides?icd=G43.0 — diagnosis knowledge-base lookup (Ф1,
 * TZ-smart-constructor).
 *
 * Matches `DiagnosisGuide.matchPrefix` as a prefix of the supplied ICD-10
 * code ("G43.0" resolves the "G43" guide). Most specific prefix wins, then
 * `sortOrder` — same convention as the protocols route. Visibility:
 * global rows (clinicId null, minus the clinic's GUIDE overlay hides) plus
 * the clinic's own rows. Clinic-own guides outrank globals on equal prefix
 * length. DiagnosisGuide is in MODELS_WITHOUT_TENANT, so the clinic filter
 * here is explicit and mandatory.
 *
 * Empty `icd` returns the full visible list (Ф4 settings screen reuses it).
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { loadHiddenCodes } from "@/server/catalog/clinic-overlay";
import { ok, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  icd: z.string().optional(),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const hidden = await loadHiddenCodes(clinicId, "GUIDE");

    const visible = await prisma.diagnosisGuide.findMany({
      where: {
        active: true,
        OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])],
      },
      orderBy: [{ matchPrefix: "asc" }, { sortOrder: "asc" }],
    });
    const rows = visible.filter(
      (g) => g.clinicId !== null || !hidden.has(g.code),
    );

    const icd = parsed.value.icd?.trim().toUpperCase();
    if (!icd) {
      return ok({ rows, total: rows.length });
    }

    const matches = rows
      .filter((g) => icd.startsWith(g.matchPrefix.toUpperCase()))
      .sort((a, b) => {
        const lenDiff = b.matchPrefix.length - a.matchPrefix.length;
        if (lenDiff !== 0) return lenDiff;
        // Clinic-own guide shadows the global one at equal specificity.
        if ((a.clinicId === null) !== (b.clinicId === null)) {
          return a.clinicId === null ? 1 : -1;
        }
        return a.sortOrder - b.sortOrder;
      });

    return ok({ rows: matches, total: matches.length });
  },
);
