/**
 * /api/crm/catalogs/drugs/facets — counts for the drug reference sidebar.
 *
 * The reference browser navigates ~2.7k drugs by ATC anatomical group, and a
 * group rail without counts is a rail nobody trusts («есть там что-нибудь по
 * нервной системе?»). One grouped query answers all of them; the numbers are
 * cheap enough to recompute per visit and stale-cached client-side.
 *
 * Audit CT-19: the counts read the same rows the list pages through, active
 * and not hidden by the clinic. They counted retired and hidden drugs too,
 * so «Все N» and the rail never matched what could be scrolled. The photo
 * count is the worklist's: what is still missing a packaging photo, on the
 * row or in the clinic's overlay.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  loadClinicOverlays,
  overlayPhotoCodes,
} from "@/server/catalog/clinic-overlay";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"] },
  async ({ ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const overlays = await loadClinicOverlays(clinicId, "DRUG");
    // Same visibility rule as the list route: active rows of the global
    // catalog the clinic has not hidden, plus this clinic's own rows, never
    // another tenant's.
    const visible: Prisma.DrugWhereInput[] = [
      { OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])] },
    ];
    if (overlays.hidden.size > 0) {
      visible.push({ id: { notIn: [...overlays.hidden] } });
    }
    const where: Prisma.DrugWhereInput = { active: true, AND: visible };
    const photographed = overlayPhotoCodes(overlays);

    const [rows, total, rxCount, dosingCount, noPhotoCount] = await Promise.all([
      prisma.drug.findMany({
        where,
        select: { atcCode: true },
      }),
      prisma.drug.count({ where }),
      prisma.drug.count({ where: { ...where, rxOnly: true } }),
      // Json column: absence is expressed with Prisma.DbNull, not null.
      prisma.drug.count({
        where: { ...where, defaultDosing: { not: Prisma.DbNull } },
      }),
      prisma.drug.count({
        where: {
          active: true,
          photoUrl: null,
          AND: [
            ...visible,
            ...(photographed.length > 0
              ? [{ id: { notIn: photographed } }]
              : []),
          ],
        },
      }),
    ]);

    // Group in memory: Prisma cannot group by a computed substring, and the
    // column is short enough that 2.7k strings cost nothing.
    const byGroup: Record<string, number> = {};
    let withoutAtc = 0;
    for (const r of rows) {
      const letter = r.atcCode?.trim().charAt(0).toUpperCase();
      // The register carries a handful of typos (Cyrillic «А», lowercase) —
      // only A-Z counts as a real group, the rest falls into "no ATC".
      if (letter && letter >= "A" && letter <= "Z") {
        byGroup[letter] = (byGroup[letter] ?? 0) + 1;
      } else {
        withoutAtc += 1;
      }
    }

    return ok({
      total,
      byGroup,
      withoutAtc,
      rxCount,
      otcCount: total - rxCount,
      dosingCount,
      noPhotoCount,
    });
  },
);
