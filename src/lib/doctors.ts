/**
 * Public-site doctor reads.
 *
 * The landing page (`/[locale]/(site)`) and the per-doctor page run with NO
 * auth session, so they carry no TenantContext. The shared Prisma client
 * (`@/lib/prisma`) fails closed on tenant-scoped models when there's no
 * context, so we do exactly what the other anonymous surfaces do
 * (`/api/c/[slug]/queue/*`, `src/lib/public-clinic.ts`): resolve the concrete
 * clinic by slug and run the queries inside `runWithTenant({ kind: "SYSTEM" })`
 * with an explicit `where: { clinicId }`. SYSTEM never auto-injects, so the
 * explicit clinicId is what keeps these reads tenant-safe.
 *
 * `isActive` is deliberately NOT filtered here: the clinic deactivates
 * doctors in the CRM to declutter the working screens (today only one doctor
 * uses the system), while the doctors themselves still see patients — the
 * public price sheet lists their cabinets. Hiding them from the public site
 * would misrepresent the clinic. If a doctor actually leaves, delete the row
 * or we add a dedicated "listed on site" flag.
 *
 * Doctors with no photo render fine on the client (the sections fall back to
 * initials), so `photoUrl` is passed through as-is (may be null).
 */
import { prisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import { DEFAULT_CLINIC_SLUG } from "./constants";
import type { Locale } from "@/types";

export interface DoctorView {
  id: string;
  slug: string;
  name: Record<Locale, string>;
  specialty: Record<Locale, string>;
  photo: string | null;
  /**
   * Whether NEW work may be directed at this doctor (Doctor.isActive).
   * The showcase renders everyone — the staff is real either way — but the
   * lead form and every «Записаться» CTA must skip non-bookable doctors:
   * a lead pinned to a doctor nobody processes in the CRM dies silently.
   */
  bookable: boolean;
}

/**
 * Resolve the public clinic id from the default slug ("neurofax"). Runs in a
 * SYSTEM scope because Clinic has no clinicId column and we're outside any
 * tenant context on these routes. Returns null when the slug doesn't resolve
 * to an active clinic — callers return empty / 404.
 */
async function resolveClinicId(): Promise<string | null> {
  const clinic = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findFirst({
      where: { slug: DEFAULT_CLINIC_SLUG, active: true },
      select: { id: true },
    }),
  );
  return clinic?.id ?? null;
}

function toView(row: {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  specializationRu: string;
  specializationUz: string;
  photoUrl: string | null;
  isActive: boolean;
}): DoctorView {
  return {
    id: row.id,
    slug: row.slug,
    name: { ru: row.nameRu, uz: row.nameUz },
    specialty: { ru: row.specializationRu, uz: row.specializationUz },
    photo: row.photoUrl,
    bookable: row.isActive,
  };
}

export async function getDoctors(): Promise<DoctorView[]> {
  // Soft-degrade on DB trouble: the landing renders without the doctors
  // section (and sitemap.ts, which runs inside `next build` where no
  // database exists, falls back to the base pages) instead of a 500 on the
  // clinic's public front door.
  try {
    const clinicId = await resolveClinicId();
    if (!clinicId) return [];

    const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.doctor.findMany({
        where: { clinicId },
        select: {
          id: true,
          slug: true,
          nameRu: true,
          nameUz: true,
          specializationRu: true,
          specializationUz: true,
          photoUrl: true,
          isActive: true,
        },
        orderBy: { nameRu: "asc" },
      }),
    );

    return rows.map(toView);
  } catch (e) {
    console.warn(`[site] getDoctors failed: ${(e as Error).message}`);
    return [];
  }
}

export async function getDoctorById(id: string): Promise<DoctorView | null> {
  try {
    const clinicId = await resolveClinicId();
    if (!clinicId) return null;

    const row = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.doctor.findFirst({
        // clinicId keeps the lookup scoped to this clinic even though id is a cuid.
        where: { id, clinicId },
        select: {
          id: true,
          slug: true,
          nameRu: true,
          nameUz: true,
          specializationRu: true,
          specializationUz: true,
          photoUrl: true,
          isActive: true,
        },
      }),
    );

    return row ? toView(row) : null;
  } catch (e) {
    console.warn(`[site] getDoctorById failed: ${(e as Error).message}`);
    return null;
  }
}
