/**
 * Phase 16 Wave 1 — Treatment plan helpers.
 *
 * Pure functions for the Mini App «План лечения» card.
 *
 * The MedicalCase schema does NOT carry a planned number of visits: courses
 * of care are open-ended in the model. The card used to project one anyway
 * (completed visits + the next booking, at least 1), so an open case with
 * one finished visit and nothing booked read «1 из 1, Лечение завершено ✓»
 * with a full bar and no «Записаться» (audit MA-11). A patient on a
 * migraine course took that as «no need to come back».
 *
 * Now nothing is made up:
 *   - «completed» comes from the case itself: only a case the doctor marked
 *     RESOLVED is finished. An OPEN case is in progress whatever its count.
 *   - Without a doctor-supplied plan length there is no denominator: the
 *     card shows the number of visits and the next booking, no «N из M» and
 *     no progress bar. `plannedVisits` is the hook for when a plan length
 *     is added to the model.
 */

export type TreatmentProgress = {
  /** Completed visits on the case. */
  done: number;
  /**
   * Planned visits, only when the doctor set a plan length (never projected
   * from the visit count). Null means «no plan length»: show `done` alone.
   */
  total: number | null;
  /** ISO string of the next upcoming visit on this case, or null. */
  nextVisitAt: string | null;
  /** 0..1, fraction of `total`; null when there is no `total`. */
  progress: number | null;
  /** True only when the case is RESOLVED: «Лечение завершено». */
  completed: boolean;
  /** True when no visit is completed and none is booked yet. */
  empty: boolean;
};

/**
 * Compute progress shape used by the <TreatmentPlanCard /> Mini App tile.
 *
 * Inputs are kept primitive (no Prisma types) so the helper is testable in
 * isolation. The route fetches the case, counts COMPLETED appointments,
 * picks the next upcoming appointment, and forwards the values here.
 */
export function computeProgress(args: {
  /** MedicalCase.status: OPEN | RESOLVED | ABANDONED | TRANSFERRED. */
  caseStatus: string;
  plannedVisits?: number | null;
  completedAppointments: number;
  nextBookedAt: Date | string | null;
}): TreatmentProgress {
  const done = Math.max(0, Math.floor(args.completedAppointments));
  const next = args.nextBookedAt
    ? typeof args.nextBookedAt === "string"
      ? args.nextBookedAt
      : args.nextBookedAt.toISOString()
    : null;

  const planned =
    typeof args.plannedVisits === "number" && args.plannedVisits > 0
      ? Math.floor(args.plannedVisits)
      : null;
  // A course that ran past its plan grows the plan, it does not overflow it.
  const total = planned === null ? null : Math.max(planned, done + (next ? 1 : 0));

  return {
    done,
    total,
    nextVisitAt: next,
    progress: total === null ? null : Math.min(1, done / total),
    completed: args.caseStatus === "RESOLVED",
    empty: done === 0 && !next,
  };
}
