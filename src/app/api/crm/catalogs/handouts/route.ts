/**
 * /api/crm/catalogs/handouts — patient handout library (Phase G5).
 *
 * Returns the curated HandoutTemplate rows for the picker drawer. Ranking:
 *   - templates whose `matchPrefixes` covers the active diagnosis come first
 *   - free-text `q` filters by title / summary / code
 *   - results group by topic on the client; we just return one flat list
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { loadHiddenCodes } from "@/server/catalog/clinic-overlay";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const dxCode = url.searchParams.get("dxCode")?.trim() ?? "";

    const where: Record<string, unknown> = { active: true };
    if (q) {
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { titleRu: { contains: q, mode: "insensitive" } },
        { titleUz: { contains: q, mode: "insensitive" } },
        { summaryRu: { contains: q, mode: "insensitive" } },
        { topic: { contains: q, mode: "insensitive" } },
      ];
    }

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const [allRows, hidden] = await Promise.all([
      prisma.handoutTemplate.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { titleRu: "asc" }],
      }),
      loadHiddenCodes(clinicId, "HANDOUT"),
    ]);
    const rows = hidden.size > 0 ? allRows.filter((r) => !hidden.has(r.code)) : allRows;

    // Rank diagnosis-matched rows to the top. Empty matchPrefixes = general,
    // ranked below specific matches but above unrelated.
    const dxUpper = dxCode.toUpperCase();
    const scored = rows
      .map((r) => {
        let score = 0;
        if (dxUpper && r.matchPrefixes.length > 0) {
          if (
            r.matchPrefixes.some((p) => dxUpper.startsWith(p.toUpperCase()))
          ) {
            score = 2;
          }
        } else if (r.matchPrefixes.length === 0) {
          score = 1;
        }
        return { row: r, score };
      })
      .sort((a, b) => b.score - a.score);

    return ok({
      templates: scored.map(({ row, score }) => ({
        id: row.id,
        code: row.code,
        titleRu: row.titleRu,
        titleUz: row.titleUz,
        summaryRu: row.summaryRu,
        bodyMd: row.bodyMd,
        matchPrefixes: row.matchPrefixes,
        topic: row.topic,
        sortOrder: row.sortOrder,
        matched: score === 2,
        general: score === 1,
      })),
      total: scored.length,
    });
  },
);
