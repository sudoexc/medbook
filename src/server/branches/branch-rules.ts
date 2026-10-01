/**
 * What a branch edit may not do (audit ST-06).
 *
 * Only "not the last active branch" used to be checked. The default branch
 * could be switched off, and `resolveEffectiveBranchId` (which looks for an
 * active default) then returned null: new doctors and cabinets were created
 * without a branch and dropped out of every branch-filtered screen. Nor was
 * the admin told that doctors, cabinets and booked visits still pointed at
 * the branch being switched off.
 */
import { UPCOMING_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";

export type BranchRefusal =
  | "last_active_branch"
  | "default_branch"
  | "inactive_default";

/**
 * Pure: the reason an edit of a branch is refused, or null.
 *
 *   - switching off the last active branch;
 *   - switching off the default branch, or unsetting its default flag: pick
 *     another default first (setting a new default clears the old one);
 *   - making a switched-off branch the default.
 */
export function branchChangeRefusal(input: {
  before: { isActive: boolean; isDefault: boolean };
  patch: { isActive?: boolean; isDefault?: boolean };
  otherActiveCount: number;
}): BranchRefusal | null {
  const { before, patch } = input;
  const nextActive = patch.isActive ?? before.isActive;
  const nextDefault = patch.isDefault ?? before.isDefault;
  const deactivating = before.isActive && !nextActive;
  if (deactivating && input.otherActiveCount === 0) return "last_active_branch";
  if (before.isDefault && (deactivating || !nextDefault)) return "default_branch";
  if (nextDefault && !nextActive) return "inactive_default";
  return null;
}

export type BranchUsage = {
  doctors: number;
  cabinets: number;
  upcomingAppointments: number;
};

export function branchInUse(u: BranchUsage): boolean {
  return u.doctors + u.cabinets + u.upcomingAppointments > 0;
}

/**
 * Run `fn` in the caller's clinic without the cookie branch scope. The
 * Prisma extension adds the selected branch to every branch-scoped query
 * (doctors, cabinets, appointments), which is right for the screens and
 * wrong for clinic-level administration: counting a branch's doctors, or
 * finding the card a doctor login holds, must see the whole clinic.
 */
export function runClinicWide<T>(
  ctx: TenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  if (ctx.kind !== "TENANT" || !ctx.branchId) return fn();
  const { branchId: _scope, ...clinicWide } = ctx;
  void _scope;
  return runWithTenant(clinicWide, fn);
}

/**
 * Active doctors, cabinets and not-yet-seen visits still on the branch,
 * counted clinic-wide (an admin working "in" another branch would count
 * zero otherwise).
 */
export async function loadBranchUsage(
  ctx: TenantContext,
  branchId: string,
  now: Date = new Date(),
): Promise<BranchUsage> {
  return runClinicWide(ctx, async () => {
    const [doctors, cabinets, upcomingAppointments] = await Promise.all([
      prisma.doctor.count({ where: { branchId, isActive: true } }),
      prisma.cabinet.count({ where: { branchId, isActive: true } }),
      prisma.appointment.count({
        where: {
          branchId,
          date: { gte: now },
          status: { in: [...UPCOMING_VISIT_STATUSES] },
        },
      }),
    ]);
    return { doctors, cabinets, upcomingAppointments };
  });
}
