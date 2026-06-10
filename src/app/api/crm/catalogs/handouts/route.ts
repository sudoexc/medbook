/**
 * /api/crm/catalogs/handouts — patient handout library (Phase G5, Ф4).
 *
 * Returns curated HandoutTemplate rows + the clinic's own rows for the
 * picker drawer. Global rows respect the clinic's HANDOUT overlay: hidden
 * ones are filtered (unless `?includeHidden=1` from the ADMIN knowledge
 * screen), `overridesJson` patches (rename, bodyMd, bodyMdUz, topic) are
 * merged before ranking. Ranking:
 *   - templates whose `matchPrefixes` covers the active diagnosis come first
 *   - free-text `q` filters by title / summary / code
 *   - results group by topic on the client; we just return one flat list
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  applyClinicOverlay,
  loadClinicOverlays,
} from "@/server/catalog/clinic-overlay";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const dxCode = url.searchParams.get("dxCode")?.trim() ?? "";
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const includeHidden =
      url.searchParams.get("includeHidden") === "1" &&
      ctx.kind === "TENANT" &&
      ctx.role === "ADMIN";

    const where: Record<string, unknown> = {
      active: true,
      OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])],
    };
    if (q) {
      where.AND = [
        {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { titleRu: { contains: q, mode: "insensitive" } },
            { titleUz: { contains: q, mode: "insensitive" } },
            { summaryRu: { contains: q, mode: "insensitive" } },
            { topic: { contains: q, mode: "insensitive" } },
          ],
        },
      ];
    }

    const [allRows, overlays] = await Promise.all([
      prisma.handoutTemplate.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { titleRu: "asc" }],
      }),
      loadClinicOverlays(clinicId, "HANDOUT"),
    ]);
    const rows = allRows
      .filter(
        (r) =>
          r.clinicId !== null || includeHidden || !overlays.hidden.has(r.code),
      )
      .map((r) =>
        r.clinicId === null
          ? {
              ...applyClinicOverlay(
                r as unknown as Record<string, unknown>,
                r.code,
                overlays,
                "HANDOUT",
              ),
              hiddenByClinic: overlays.hidden.has(r.code),
            }
          : { ...r, clinicOverridden: false, hiddenByClinic: false },
      ) as Array<
      (typeof allRows)[number] & {
        clinicOverridden: boolean;
        hiddenByClinic: boolean;
      }
    >;

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
        bodyMdUz: row.bodyMdUz,
        matchPrefixes: row.matchPrefixes,
        topic: row.topic,
        sortOrder: row.sortOrder,
        clinicId: row.clinicId,
        clinicOverridden: row.clinicOverridden,
        hiddenByClinic: row.hiddenByClinic,
        matched: score === 2,
        general: score === 1,
      })),
      total: scored.length,
    });
  },
);
