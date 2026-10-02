/**
 * The packaging photo of a prescribed drug as this clinic sees it.
 *
 * The global catalog ships no photos: a clinic's photo of a global drug is
 * stored in its ClinicCatalogOverlay (catalogs/drugs/[id]/photo), and only a
 * clinic-owned row carries it on Drug.photoUrl. Search applies the overlay
 * (drug-hits.ts), but the note, its print and the Telegram send read
 * `drug.photoUrl` off the prescription row, so a photographed global drug
 * showed its box in the dropdown and nowhere after it was prescribed
 * (audit VW-27). This puts the overlay's photo on those rows.
 */
import { prisma } from "@/lib/prisma";
import { sanitizeOverrides } from "@/server/catalog/clinic-overlay";

type RowWithDrug = {
  drugId?: string | null;
  drug?: { photoUrl: string | null } | null;
};

/**
 * The rows with each linked drug's photo resolved for the clinic: its
 * overlay photo when it has one (only global rows get overlays), else the
 * row's own. One query for the rows' drugs, none when nothing is linked.
 */
export async function withClinicDrugPhotos<R extends RowWithDrug>(
  clinicId: string | null | undefined,
  rows: R[],
): Promise<R[]> {
  if (!clinicId || !rows?.length) return rows;
  const ids = [
    ...new Set(
      rows.flatMap((r) => (r.drug && r.drugId ? [r.drugId] : [])),
    ),
  ];
  if (ids.length === 0) return rows;

  const overlays = await prisma.clinicCatalogOverlay.findMany({
    where: { clinicId, entityType: "DRUG", entityCode: { in: ids } },
    select: { entityCode: true, overridesJson: true },
  });
  const photoOf = new Map<string, string>();
  for (const o of overlays) {
    const photo = sanitizeOverrides("DRUG", o.overridesJson)?.photoUrl;
    if (typeof photo === "string" && photo) photoOf.set(o.entityCode, photo);
  }
  if (photoOf.size === 0) return rows;

  return rows.map((r) => {
    const photo = r.drugId ? photoOf.get(r.drugId) : undefined;
    return photo && r.drug ? { ...r, drug: { ...r.drug, photoUrl: photo } } : r;
  });
}
