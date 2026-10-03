/**
 * Whose arsenal a request is about, and whether the caller may touch it.
 *
 *   - no `doctorId`: the caller's own doctor card (a DOCTOR on his page);
 *   - a `doctorId`: that doctor of the caller's clinic, for the clinic's
 *     ADMIN preparing it from the CRM doctor page, or a DOCTOR naming his
 *     own card. A DOCTOR naming a colleague is refused.
 *
 * Clinic scoping is double: the Doctor read runs under the tenant extension
 * (another clinic's doctor is simply not found), and `canManageArsenal`
 * compares the clinics again. The pins hang off the doctor's login
 * (DoctorFavorite has no clinicId, it is in MODELS_WITHOUT_TENANT), so that
 * login is checked to belong to the same clinic before anything is read or
 * written under it.
 */
import { canManageArsenal } from "@/lib/arsenal";
import { prisma } from "@/lib/prisma";
import type { TenantContext } from "@/lib/tenant-context";
import { err } from "@/server/http";

export type ArsenalDoctor = {
  id: string;
  userId: string;
  clinicId: string;
  nameRu: string;
  nameUz: string;
  frequentDrugLimit: number;
  frequentDiagnosisLimit: number;
};

const DOCTOR_SELECT = {
  id: true,
  userId: true,
  clinicId: true,
  nameRu: true,
  nameUz: true,
  frequentDrugLimit: true,
  frequentDiagnosisLimit: true,
} as const;

export async function resolveArsenalDoctor(
  ctx: TenantContext,
  doctorId: string | null | undefined,
): Promise<{ ok: true; doctor: ArsenalDoctor } | { ok: false; response: Response }> {
  if (ctx.kind !== "TENANT") return { ok: false, response: err("Forbidden", 403) };

  const doctor = doctorId
    ? await prisma.doctor.findFirst({ where: { id: doctorId }, select: DOCTOR_SELECT })
    : await prisma.doctor.findFirst({ where: { userId: ctx.userId }, select: DOCTOR_SELECT });
  if (!doctor) {
    return {
      ok: false,
      response: doctorId
        ? err("NotFound", 404)
        : err("DoctorProfileMissing", 403, { reason: "no_doctor_row_for_user" }),
    };
  }

  const allowed = canManageArsenal(
    { role: ctx.role, userId: ctx.userId, clinicId: ctx.clinicId },
    { userId: doctor.userId, clinicId: doctor.clinicId },
  );
  if (!allowed) return { ok: false, response: err("Forbidden", 403) };

  if (!doctor.userId) {
    // His pins live on his login; a card without one has nowhere to keep
    // them yet. The page says so instead of saving into the void.
    return {
      ok: false,
      response: err("DoctorHasNoLogin", 409, { reason: "doctor_has_no_login" }),
    };
  }
  const login = await prisma.user.findFirst({
    where: { id: doctor.userId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!login) {
    return {
      ok: false,
      response: err("DoctorHasNoLogin", 409, { reason: "doctor_login_elsewhere" }),
    };
  }

  return { ok: true, doctor: { ...doctor, userId: doctor.userId } };
}
