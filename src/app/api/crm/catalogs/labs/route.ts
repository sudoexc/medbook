/**
 * /api/crm/catalogs/labs — combined lab test + panel search (Phase G3).
 *
 * Returns two parallel lists: `tests` (LabTest) and `panels` (LabPanel with
 * a denormalised `testCodes` list pulled from the join table). The order
 * dialog hits this on every keystroke to render the search results panel.
 *
 * The optional `forCode` query parameter passes the visit's ICD-10 code:
 * tests where `commonForCodes` contains the code (or a prefix of it) sort
 * to the top.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { loadHiddenCodes } from "@/server/catalog/clinic-overlay";
import { ok, parseQuery } from "@/server/http";
import { QueryLabCatalogSchema } from "@/server/schemas/lab";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE", "RECEPTIONIST"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryLabCatalogSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const testWhere: Record<string, unknown> = { active: q.active ?? true };
    if (q.biomaterial) testWhere.biomaterial = q.biomaterial;
    if (q.q && q.q.trim()) {
      const term = q.q.trim();
      testWhere.OR = [
        { code: { contains: term, mode: "insensitive" } },
        { nameRu: { contains: term, mode: "insensitive" } },
        { nameUz: { contains: term, mode: "insensitive" } },
        { loinc: { contains: term, mode: "insensitive" } },
      ];
    }

    const panelWhere: Record<string, unknown> = { active: q.active ?? true };
    if (q.q && q.q.trim()) {
      const term = q.q.trim();
      panelWhere.OR = [
        { code: { contains: term, mode: "insensitive" } },
        { nameRu: { contains: term, mode: "insensitive" } },
        { nameUz: { contains: term, mode: "insensitive" } },
      ];
    }

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const [allTests, allPanels, hiddenTests, hiddenPanels] = await Promise.all([
      prisma.labTest.findMany({
        where: testWhere,
        orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }],
        take: q.limit,
      }),
      prisma.labPanel.findMany({
        where: panelWhere,
        orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }],
        include: {
          tests: {
            orderBy: { sortOrder: "asc" },
            include: { test: { select: { code: true, nameRu: true } } },
          },
        },
      }),
      loadHiddenCodes(clinicId, "LAB_TEST"),
      loadHiddenCodes(clinicId, "LAB_PANEL"),
    ]);
    const tests = hiddenTests.size > 0
      ? allTests.filter((t) => !hiddenTests.has(t.code))
      : allTests;
    const panels = hiddenPanels.size > 0
      ? allPanels.filter((p) => !hiddenPanels.has(p.code))
      : allPanels;

    const rankedTests = (() => {
      if (!q.forCode || !q.forCode.trim()) return tests;
      const code = q.forCode.trim().toUpperCase();
      return [...tests].sort((a, b) => {
        const aMatch = a.commonForCodes.some((c) =>
          code.startsWith(c.toUpperCase()),
        )
          ? 1
          : 0;
        const bMatch = b.commonForCodes.some((c) =>
          code.startsWith(c.toUpperCase()),
        )
          ? 1
          : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        return a.sortOrder - b.sortOrder;
      });
    })();

    const panelRows = panels.map((p) => ({
      id: p.id,
      code: p.code,
      nameRu: p.nameRu,
      nameUz: p.nameUz,
      description: p.description,
      testCodes: p.tests.map((t) => t.test.code),
      testNames: p.tests.map((t) => ({
        code: t.test.code,
        nameRu: t.test.nameRu,
      })),
      sortOrder: p.sortOrder,
    }));

    return ok({
      tests: rankedTests,
      panels: panelRows,
      total: rankedTests.length + panelRows.length,
    });
  },
);
