/**
 * Whose numbers an analytics request may see (audit AN-06).
 *
 * ADMIN sees the clinic. A DOCTOR sees only their own slice, and the slice
 * is resolved fail-closed: the endpoints used to do
 * `doctorId = (await prisma.doctor.findFirst({ where: { userId } }))?.id ?? null`
 * and apply the filter only when an id came back. A doctor login with no
 * Doctor row, or one whose `active_branch_id` cookie (unsigned) pointed at
 * another branch, got `null`, the filter vanished, and the clinic's revenue
 * by day and every colleague's earnings came back.
 *
 * Two fixes live here:
 *   - no Doctor row means `denied`, never «the whole clinic»;
 *   - the lookup ignores the active branch. Doctor is a branch-scoped model,
 *     so under a branch context the Prisma extension adds `branchId = …` and
 *     a doctor seen through another branch looked like no doctor at all.
 *     `Doctor.userId` is unique, so the clinic and the user are enough.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";

export type AnalyticsScope =
  | { kind: "clinic" }
  | { kind: "doctor"; doctorId: string }
  | { kind: "denied" };

export async function resolveAnalyticsScope(
  ctx: TenantContext | undefined,
): Promise<AnalyticsScope> {
  if (!ctx || ctx.kind !== "TENANT" || ctx.role !== "DOCTOR") {
    return { kind: "clinic" };
  }
  const doctor = await runWithTenant(
    { ...ctx, branchId: undefined },
    () =>
      prisma.doctor.findFirst({
        where: { userId: ctx.userId, clinicId: ctx.clinicId },
        select: { id: true },
      }),
  );
  return doctor ? { kind: "doctor", doctorId: doctor.id } : { kind: "denied" };
}
