/**
 * /api/crm/catalogs/drugs/[id]/similar — «чем заменить».
 *
 * A pharmacy site answers "what is in stock". A clinical catalog can answer
 * the question the doctor is actually asked twenty times a day: «этого нет в
 * аптеке, чем заменить?» We have what a shop does not — the substance, the
 * ATC class and every registered trade name in the country — so the answer
 * comes in two tiers, strongest first:
 *
 *   1. SAME SUBSTANCE (`brands`): different boxes, identical molecule. This
 *      is a straight swap and needs no clinical thought.
 *   2. SAME ATC CLASS (`alternatives`): a different molecule from the same
 *      therapeutic group — a decision, not a swap, so it is labelled as one
 *      and ranked after. Matching is on the 5-character ATC prefix («N02BE»),
 *      the level at which drugs are genuinely interchangeable in practice;
 *      the full 7-character code would collapse to near-duplicates and a
 *      3-character one would suggest a laxative for a headache.
 *
 * The clinic's catalog overlay applies here like everywhere else a doctor
 * picks a drug: a global row the clinic hid is never offered as a
 * replacement, and its renames and photos show through.
 */
import { Prisma } from "@/generated/prisma/client";
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  applyClinicOverlay,
  loadClinicOverlays,
} from "@/server/catalog/clinic-overlay";
import { ok, err } from "@/server/http";

const MAX_PER_TIER = 12;

const ALT_SELECT = {
  id: true,
  nameRu: true,
  atcCode: true,
  rxOnly: true,
  photoUrl: true,
  clinicId: true,
  brands: { select: { name: true }, take: 3 },
} as const satisfies Prisma.DrugSelect;

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../drugs/[id]/similar
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const visible = {
      OR: [{ clinicId: null }, ...(clinicId ? [{ clinicId }] : [])],
    };

    const drug = await prisma.drug.findFirst({
      where: { id, ...visible },
      select: {
        id: true,
        nameRu: true,
        inn: true,
        atcCode: true,
        brands: { select: { name: true, manufacturer: true } },
      },
    });
    if (!drug) return err("NotFound", 404);

    // Tier 1 — the same molecule under other trade names. Most of the time
    // this IS the answer, and it costs nothing: the brands are already on
    // the row.
    const brands = drug.brands
      .map((b) => ({ name: b.name, manufacturer: b.manufacturer }))
      .slice(0, 25);

    // Tier 2 — same therapeutic class, different molecule.
    const atc5 = drug.atcCode?.trim().toUpperCase().slice(0, 5) ?? null;
    let alternatives: Prisma.DrugGetPayload<{ select: typeof ALT_SELECT }>[] = [];
    if (atc5 && atc5.length >= 4) {
      const overlays = await loadClinicOverlays(clinicId, "DRUG");
      const classWhere = {
        ...visible,
        active: true,
        // Hidden globals are filtered in the query, so they cannot use up
        // the tier's places either.
        id: { notIn: [drug.id, ...overlays.hidden] },
        atcCode: { startsWith: atc5, mode: "insensitive" as const },
      };
      // Curated rows first: they carry dosing text a doctor can prescribe
      // from, the register rows only a name. Two queries, because Prisma
      // cannot order by whether a JSON column is null, and a register class
      // runs to a hundred rows (B05BB), so sorting a sample would miss them.
      const curated = await prisma.drug.findMany({
        where: { ...classWhere, defaultDosing: { not: Prisma.AnyNull } },
        select: ALT_SELECT,
        orderBy: [{ nameRu: "asc" }],
        take: MAX_PER_TIER,
      });
      const register =
        curated.length < MAX_PER_TIER
          ? await prisma.drug.findMany({
              where: { ...classWhere, defaultDosing: { equals: Prisma.AnyNull } },
              select: ALT_SELECT,
              orderBy: [{ nameRu: "asc" }],
              take: MAX_PER_TIER - curated.length,
            })
          : [];
      alternatives = [...curated, ...register].map((a) =>
        a.clinicId === null ? applyClinicOverlay(a, a.id, overlays, "DRUG") : a,
      );
    }

    return ok({
      drugId: drug.id,
      nameRu: drug.nameRu,
      atcCode: drug.atcCode,
      brands,
      alternatives: alternatives.map((a) => ({
        id: a.id,
        nameRu: a.nameRu,
        atcCode: a.atcCode,
        rxOnly: a.rxOnly,
        photoUrl: a.photoUrl,
        brandNames: a.brands.map((b) => b.name),
      })),
    });
  },
);
