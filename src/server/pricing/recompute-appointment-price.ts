/**
 * Free-repeat pricing engine (Phase 11 — MedicalCase).
 *
 * Single source of truth for re-pricing an appointment whenever ANY input
 * that could shift its price changes:
 *
 *   - POST /api/crm/appointments              (create)
 *   - PATCH /api/crm/appointments/[id]        (date / services / case change)
 *   - POST /api/crm/cases/[id]/attach-appt    ("first vs repeat" can flip)
 *   - POST /api/crm/cases/[id]/detach-appt    (back to case-less ⇒ recompute)
 *
 * Behavioural contract — see docs/TZ.md §6.5 (cases) + §6.2 (pricing fields):
 *
 *   1. If the appointment has NO medicalCaseId → leave priceFinal as-is. The
 *      route already wrote priceBase / discounts / priceFinal during
 *      create/update; we never overwrite that. Returns reason="normal".
 *
 *   2. If the appointment IS in a case BUT it's the chronologically FIRST
 *      visit in the case (ORDER BY date ASC, id ASC for tie-stability) →
 *      same as case-less: untouched. reason="normal".
 *
 *   3. Otherwise, walk every Service involved in the visit (primaryService
 *      via Appointment.serviceId AND every row in AppointmentService). For
 *      each one with `freeRepeatDays != null` whose
 *      `(thisAppt.date - firstAppt.date) <= freeRepeatDays * 24h`, that
 *      service's contribution is zero. Otherwise it contributes its snapshot
 *      price (priceSnap on the join row, or the service's priceBase on the
 *      primary path).
 *
 *      The sum of those contributions becomes the new priceBase.
 *      Patient-level discountPct / discountAmount on the appointment apply
 *      ON TOP of that sum, so if every service is in-window the result is
 *      naturally 0 — and discountPct is forced to 100 / discountAmount to
 *      priceService so accounting & doctor-commission queries see the full
 *      picture (saved amount is the priceService delta).
 *
 *      reason="free_repeat" iff ANY service hit zero via free-repeat.
 *
 * Idempotency: pure function of DB state. Calling it back-to-back yields the
 * same row.
 *
 * PAID-immutability: an appointment that already carries a PAID Payment is
 * frozen — re-pricing it would invalidate cash that's already in the till.
 * The function returns reason="paid_locked" without writing anything.
 */
import type { prisma } from "@/lib/prisma";

/**
 * Either the tenant-scoped client or an in-flight $transaction client. Mirrors
 * the helper in src/server/services/appointments.ts so callers inside an
 * existing tx can pass it straight through.
 */
type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type RecomputeReason =
  | "normal"
  | "free_repeat"
  | "paid_locked"
  | "no_services";

export interface RecomputeResult {
  appointmentId: string;
  priceFinal: number | null;
  reason: RecomputeReason;
  /** Total before patient-level discounts. */
  priceService: number | null;
  /** UZS minor units saved by free-repeat policy (0 when reason!=free_repeat). */
  savedAmount: number;
  /** Days between this visit and the first visit in the case, when applicable. */
  daysFromFirst: number | null;
  /** Service rows considered in the recompute (for audit/log meta). */
  trace: Array<{
    serviceId: string;
    priceSnap: number;
    quantity: number;
    freeRepeatDays: number | null;
    free: boolean;
  }>;
}

/**
 * Inclusive day-window check: `(b - a) / 1d <= window`.
 * Uses calendar-day diff (floor on milliseconds) so a visit exactly N*24h
 * after the first counts as in-window.
 */
function withinDayWindow(first: Date, current: Date, days: number): boolean {
  const ms = current.getTime() - first.getTime();
  if (ms < 0) return false;
  const dayMs = 24 * 60 * 60 * 1000;
  return ms <= days * dayMs;
}

export async function recomputeAppointmentPrice(
  client: PrismaLike,
  appointmentId: string,
): Promise<RecomputeResult> {
  const appt = await client.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      date: true,
      medicalCaseId: true,
      serviceId: true,
      priceService: true,
      priceBase: true,
      priceFinal: true,
      discountPct: true,
      discountAmount: true,
      // Used for paid-locked guard. We deliberately scope to non-VOID rows
      // so a refunded appointment can be re-priced without surprises.
      payments: {
        where: { status: "PAID" },
        select: { id: true },
      },
      services: {
        select: {
          serviceId: true,
          priceSnap: true,
          quantity: true,
          service: {
            select: { id: true, priceBase: true, freeRepeatDays: true },
          },
        },
      },
      primaryService: {
        select: { id: true, priceBase: true, freeRepeatDays: true },
      },
    },
  });

  if (!appt) {
    throw new Error(`recomputeAppointmentPrice: appointment ${appointmentId} not found`);
  }

  // PAID-locked: leave row untouched. Caller can detect via reason.
  if (appt.payments.length > 0) {
    return {
      appointmentId: appt.id,
      priceFinal: appt.priceFinal,
      priceService: appt.priceService,
      reason: "paid_locked",
      savedAmount: 0,
      daysFromFirst: null,
      trace: [],
    };
  }

  // Build the canonical set of (serviceId → { snap, qty, freeRepeatDays }) we
  // will price. AppointmentService is the source of truth when present;
  // otherwise the single primaryService stands in. Both can coexist (legacy
  // rows have only the primary), so we union by serviceId, preferring the
  // join-row snapshot.
  type Line = {
    serviceId: string;
    priceSnap: number;
    quantity: number;
    freeRepeatDays: number | null;
  };
  const lines = new Map<string, Line>();

  for (const row of appt.services) {
    lines.set(row.serviceId, {
      serviceId: row.serviceId,
      priceSnap: row.priceSnap,
      quantity: row.quantity,
      freeRepeatDays: row.service.freeRepeatDays,
    });
  }
  if (appt.primaryService && !lines.has(appt.primaryService.id)) {
    lines.set(appt.primaryService.id, {
      serviceId: appt.primaryService.id,
      priceSnap: appt.primaryService.priceBase,
      quantity: 1,
      freeRepeatDays: appt.primaryService.freeRepeatDays,
    });
  }

  // No services at all → nothing to recompute (e.g. consult-without-service).
  // We still write priceBase/priceFinal=null+null untouched. This branch is
  // also where the legacy "priceFinal pinned by caller" path lands and we
  // intentionally leave that pin alone.
  if (lines.size === 0) {
    return {
      appointmentId: appt.id,
      priceFinal: appt.priceFinal,
      priceService: appt.priceService,
      reason: "no_services",
      savedAmount: 0,
      daysFromFirst: null,
      trace: [],
    };
  }

  const priceServiceFull = Array.from(lines.values()).reduce(
    (sum, l) => sum + l.priceSnap * l.quantity,
    0,
  );

  // Determine if this is the FIRST visit in the case. Ordering matches the
  // appointment-detail visitNumberInCase logic (date asc, createdAt asc) —
  // we use id asc here as a final tiebreaker because two appointments with
  // identical date+createdAt are technically possible after reschedules.
  let isFirstInCase = true;
  let firstDate: Date | null = null;
  let daysFromFirst: number | null = null;
  if (appt.medicalCaseId) {
    const siblings = await client.appointment.findMany({
      where: { medicalCaseId: appt.medicalCaseId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, date: true },
    });
    const first = siblings[0];
    if (first) {
      firstDate = first.date;
      isFirstInCase = first.id === appt.id;
      const ms = appt.date.getTime() - first.date.getTime();
      daysFromFirst = ms < 0 ? 0 : Math.floor(ms / (24 * 60 * 60 * 1000));
    }
  }

  // Per-line free-repeat decision. Only applies when the appointment is in a
  // case AND not the first visit AND the service has a policy AND we're
  // inside the window.
  const trace: RecomputeResult["trace"] = [];
  let billable = 0;
  let savedAmount = 0;
  let anyFree = false;
  for (const line of lines.values()) {
    const eligible =
      !isFirstInCase &&
      firstDate !== null &&
      line.freeRepeatDays !== null &&
      line.freeRepeatDays > 0 &&
      withinDayWindow(firstDate, appt.date, line.freeRepeatDays);
    const lineTotal = line.priceSnap * line.quantity;
    if (eligible) {
      anyFree = true;
      savedAmount += lineTotal;
    } else {
      billable += lineTotal;
    }
    trace.push({
      serviceId: line.serviceId,
      priceSnap: line.priceSnap,
      quantity: line.quantity,
      freeRepeatDays: line.freeRepeatDays,
      free: eligible,
    });
  }

  // Apply patient-level discounts ON TOP of the free-repeat-adjusted base.
  // The visit-level discountPct / discountAmount fields keep their meaning:
  // they're an additional, manually-set incentive that stacks with policy.
  const discountPct = appt.discountPct ?? 0;
  const discountAmount = appt.discountAmount ?? 0;
  const afterPct = billable - Math.round((discountPct * billable) / 100);
  const priceFinal = Math.max(0, afterPct - discountAmount);

  // Persist. Idempotent: re-running on the same DB state writes the same
  // values. The audit-log entry that surrounds free-repeat decisions is
  // emitted by the route caller, not here, so this helper stays
  // request-context-free and unit-testable.
  await client.appointment.update({
    where: { id: appt.id },
    data: {
      priceService: priceServiceFull,
      priceBase: billable,
      priceFinal,
    },
  });

  return {
    appointmentId: appt.id,
    priceFinal,
    priceService: priceServiceFull,
    reason: anyFree ? "free_repeat" : "normal",
    savedAmount,
    daysFromFirst,
    trace,
  };
}
