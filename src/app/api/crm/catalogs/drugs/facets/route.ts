/**
 * /api/crm/catalogs/drugs/facets — counts for the drug reference sidebar.
 *
 * The reference browser navigates ~2.7k drugs by ATC anatomical group, and a
 * group rail without counts is a rail nobody trusts («есть там что-нибудь по
 * нервной системе?»). One grouped query answers all of them; the numbers are
 * cheap enough to recompute per visit and stale-cached client-side.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"] },
  async ({ ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    // Same visibility rule as the list route: the global catalog plus this
    // clinic's own rows, never another tenant's.
    const where = {
      OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])],
    };

    const [rows, total, rxCount, dosingCount, photoCount] = await Promise.all([
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
      prisma.drug.count({ where: { ...where, photoUrl: { not: null } } }),
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
      photoCount,
    });
  },
);
