/**
 * Phase 19 Wave 1 — usage tracking.
 *
 * `getClinicUsage(clinicId, now?)` returns a snapshot of the four numeric
 * dimensions that map onto the per-plan quotas declared in
 * `src/lib/feature-flags.ts`:
 *
 *   - patientCount               — active (deletedAt IS NULL) Patient rows
 *   - appointmentCountThisMonth  — Appointment rows whose `createdAt` falls
 *                                  inside `[startOfMonth(now), nextMonth)`.
 *                                  Booking-time count, not visit-time, so a
 *                                  cancelled appointment still counts (the
 *                                  clinic spent a slot reserving it).
 *   - smsCountThisMonth          — NotificationSend rows with channel=SMS in
 *                                  the same month window.
 *   - storageMb                  — sum of `Document.sizeBytes` divided by
 *                                  1 048 576, rounded to the nearest MB.
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

export type UsageSnapshot = {
  patientCount: number;
  appointmentCountThisMonth: number;
  smsCountThisMonth: number;
  storageMb: number;
  asOf: Date;
};

/**
 * Pure helper. Given `now`, return `[start, end)` where `start` is the first
 * instant of the calendar month containing `now` and `end` is the first
 * instant of the next month. Half-open interval matches the way Prisma's
 * `gte` + `lt` operators line up.
 *
 * Uses UTC to keep test fixtures deterministic; the clinic-tz nuance can
 * land in a follow-up wave when the dashboard exposes localized billing
 * cycles. For Wave 1 the goal is consistent counting, not localized boundaries.
 */
export function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { start, end };
}

const BYTES_PER_MB = 1_048_576;

export async function getClinicUsage(
  clinicId: string,
  now: Date = new Date(),
): Promise<UsageSnapshot> {
  const { start, end } = monthWindow(now);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const [
      patientCount,
      appointmentCountThisMonth,
      smsCountThisMonth,
      storageAgg,
    ] = await Promise.all([
      prisma.patient.count({
        where: { clinicId, deletedAt: null },
      }),
      prisma.appointment.count({
        where: { clinicId, createdAt: { gte: start, lt: end } },
      }),
      prisma.notificationSend.count({
        where: {
          clinicId,
          channel: "SMS",
          createdAt: { gte: start, lt: end },
        },
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
      smsCountThisMonth,
      storageMb,
      asOf: now,
    };
  });
}
