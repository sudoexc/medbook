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
 * would misrepresent the clinic. What the site shows is `listedOnSite`
 * (audit LD-08), the «Показывать на сайте» switch on the doctor's card: a
 * doctor who left cannot be deleted once he has history, and used to stay
 * in «Наши специалисты», in the booking form and on his own page while
 * patients phoned asking for him. Unlisted, he is gone from all three and
 * from the sitemap; his page answers 404.
 *
 * Doctors with no photo render fine on the client (the sections fall back to
 * initials), so `photoUrl` is passed through as-is (may be null).
 */
import { prisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import { DEFAULT_CLINIC_SLUG } from "./constants";
import type { ScheduleRowLike } from "./doctor-working-windows";
import type { Locale } from "@/types";

/**
 * One active weekly schedule row, dates as ISO strings so the view crosses
 * the server/client boundary as plain JSON. Working hours are public anyway
 * (they are what the clinic advertises).
 */
export type PublicScheduleRow = ScheduleRowLike & {
  validFrom: string | null;
  validTo: string | null;
};

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
  /**
   * Active schedule rows, so the lead form greys out the doctor's days off
   * with the same rule the booking engine applies (`workingWindowsFor`,
   * audit AP-01). Empty = no schedule set up.
   */
  schedule: PublicScheduleRow[];
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

/** The doctors the public site may show: this clinic's, switched on for the site. */
export function siteDoctorWhere(clinicId: string): { clinicId: string; listedOnSite: true } {
  return { clinicId, listedOnSite: true };
}

function toView(
  row: {
    id: string;
    slug: string;
    nameRu: string;
    nameUz: string;
    specializationRu: string;
    specializationUz: string;
    photoUrl: string | null;
    isActive: boolean;
  },
  schedule: PublicScheduleRow[],
): DoctorView {
  return {
    id: row.id,
    slug: row.slug,
    name: { ru: row.nameRu, uz: row.nameUz },
    specialty: { ru: row.specializationRu, uz: row.specializationUz },
    photo: row.photoUrl,
    bookable: row.isActive,
    schedule,
  };
}

/** Active schedule rows of the given doctors, keyed by doctor id. */
async function loadSchedules(
  clinicId: string,
  doctorIds: string[],
): Promise<Map<string, PublicScheduleRow[]>> {
  const out = new Map<string, PublicScheduleRow[]>();
  if (doctorIds.length === 0) return out;
  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.doctorSchedule.findMany({
      where: { clinicId, doctorId: { in: doctorIds }, isActive: true },
      select: {
        doctorId: true,
        weekday: true,
        startTime: true,
        endTime: true,
        validFrom: true,
        validTo: true,
      },
    }),
  );
  for (const r of rows) {
    const list = out.get(r.doctorId) ?? [];
    list.push({
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
      validFrom: r.validFrom?.toISOString() ?? null,
      validTo: r.validTo?.toISOString() ?? null,
    });
    out.set(r.doctorId, list);
  }
  return out;
}

export async function getDoctors(): Promise<DoctorView[]> {
  // Soft-degrade on DB trouble: the landing renders without the doctors
  // section instead of a 500 on the clinic's public front door. (The
  // sitemap reads `getSiteDoctorPages`, which does not hide an error.)
  try {
    const clinicId = await resolveClinicId();
    if (!clinicId) return [];

    const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.doctor.findMany({
        where: siteDoctorWhere(clinicId),
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

    const schedules = await loadSchedules(
      clinicId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toView(r, schedules.get(r.id) ?? []));
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
        where: { id, ...siteDoctorWhere(clinicId) },
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

    if (!row) return null;
    const schedules = await loadSchedules(clinicId, [row.id]);
    return toView(row, schedules.get(row.id) ?? []);
  } catch (e) {
    console.warn(`[site] getDoctorById failed: ${(e as Error).message}`);
    return null;
  }
}

/**
 * One sitemap entry per doctor page (audit LD-05): the listed doctors with
 * the time their profile last changed. Unlike `getDoctors` this THROWS on a
 * database error: a sitemap built from an empty list would tell search
 * engines every doctor page is gone, a 500 makes them come back later.
 */
export async function getSiteDoctorPages(): Promise<{ id: string; updatedAt: Date }[]> {
  const clinicId = await resolveClinicId();
  if (!clinicId) return [];
  return runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.doctor.findMany({
      where: siteDoctorWhere(clinicId),
      select: { id: true, updatedAt: true },
      orderBy: { nameRu: "asc" },
    }),
  );
}
