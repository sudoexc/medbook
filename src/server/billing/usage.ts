/**
 * Phase 19 Wave 1 — usage tracking.
 *
 * `getClinicUsage(clinicId, now?)` returns a snapshot of the numeric
 * dimensions that map onto the per-plan quotas declared in
 * `src/lib/feature-flags.ts`:
 *
 *   - patientCount               — active (deletedAt IS NULL) Patient rows
 *   - appointmentCountThisMonth  — Appointment rows whose `createdAt` falls
 *                                  inside `[startOfMonth(now), nextMonth)`.
 *                                  Booking-time count, not visit-time, so a
 *                                  cancelled appointment still counts (the
 *                                  clinic spent a slot reserving it).
 *   - storageMb                  — sum of `Document.sizeBytes` divided by
 *                                  1 048 576, rounded to the nearest MB.
 *
 * The legacy `smsCountThisMonth` dimension was removed in Wave 3 of
 * `docs/TZ-sms-removal.md` alongside `maxSmsPerMonth`.
 *
 * Tenant context: the helper runs inside `runWithTenant({ kind: "SYSTEM" })`
 * so the tenant-scope Prisma extension does not double-filter. Each query
 * passes `where: { clinicId }` explicitly so the result is still scoped.
 *
 * The pure helper `monthWindow(now)` is exported for unit testing — the
 * production path and the tests share the exact same boundary math.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { monthWindow } from "@/server/billing/quota-rule";

export type UsageSnapshot = {
  patientCount: number;
  appointmentCountThisMonth: number;
  storageMb: number;
  asOf: Date;
};

// `monthWindow` lives with the rest of the quota rule (quota-rule.ts) so
// the prisma-free pre-deploy dry run can import it; re-exported for callers.
export { monthWindow };

const BYTES_PER_MB = 1_048_576;

export async function getClinicUsage(
  clinicId: string,
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  const { start, end } = monthWindow(now);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const [patientCount, appointmentCountThisMonth, storageAgg] =
      await Promise.all([
        prisma.patient.count({
          where: { clinicId, deletedAt: null },
        }),
        prisma.appointment.count({
          where: { clinicId, createdAt: { gte: start, lt: end } },
        }),
        prisma.document.aggregate({
          where: { clinicId },
          _sum: { sizeBytes: true },
        }),
      ]);

    const sizeBytes = storageAgg._sum.sizeBytes ?? 0;
    const storageMb = Math.round(sizeBytes / BYTES_PER_MB);

    return {
      patientCount,
      appointmentCountThisMonth,
      storageMb,
      asOf: now,
    };
  });
}
