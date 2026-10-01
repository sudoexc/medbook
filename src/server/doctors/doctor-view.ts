/**
 * Which Doctor columns each staff role may read through the CRM doctor
 * endpoints (audit DR-09).
 *
 * `GET /api/crm/doctors` and `/api/crm/doctors/[id]` are open to reception,
 * nurses, call operators and doctors, and used to return the whole row: the
 * salary percent of every colleague, the login id, the personal TV token and
 * the wet-signature image sat in the devtools of anyone at the front desk,
 * together with the reasons for time off («больничный»).
 *
 *   - ADMIN (and a SUPER_ADMIN acting in the clinic) — the whole row;
 *   - DOCTOR — the shared columns plus `userId`: an internal referral is
 *     addressed to the colleague's login (`Referral.toDoctorId` is a User);
 *   - everyone else — the shared columns only.
 *
 * A new column stays admin-only until someone adds it here on purpose.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { TenantContext } from "@/lib/tenant-context";

/** Columns every staff role may see: what the doctor cards, pickers and boards render. */
export const DOCTOR_SHARED_SELECT = {
  id: true,
  clinicId: true,
  branchId: true,
  slug: true,
  nameRu: true,
  nameUz: true,
  specializationRu: true,
  specializationUz: true,
  photoUrl: true,
  bioRu: true,
  bioUz: true,
  rating: true,
  reviewCount: true,
  color: true,
  // The walk-in price is on the public price sheet anyway.
  pricePerVisit: true,
  maxBookableSlotsPerDay: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  cabinetId: true,
  ticketPrefix: true,
  cabinet: true,
} as const satisfies Prisma.DoctorSelect;

export type DoctorAudience = "admin" | "doctor" | "staff";

export function doctorAudience(ctx: TenantContext): DoctorAudience {
  if (ctx.kind === "SUPER_ADMIN") return "admin";
  if (ctx.kind !== "TENANT") return "staff";
  if (ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN") return "admin";
  if (ctx.role === "DOCTOR") return "doctor";
  return "staff";
}

/**
 * The list/detail select for an audience, or `null` for "the whole row"
 * (the admin screens edit every column).
 */
export function doctorSelectFor(
  audience: DoctorAudience,
): (typeof DOCTOR_SHARED_SELECT & { userId?: true }) | null {
  if (audience === "admin") return null;
  if (audience === "doctor") return { ...DOCTOR_SHARED_SELECT, userId: true };
  return DOCTOR_SHARED_SELECT;
}
