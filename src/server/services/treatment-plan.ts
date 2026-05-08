/**
 * Phase 16 Wave 1 — Treatment plan helpers.
 *
 * Pure functions for the Mini App "Лечение мигрени · 3 из 5 визитов" card.
 *
 * NOTE: The Phase 12 MedicalCase schema does NOT carry an explicit
 * `plannedVisits` field — courses of care are open-ended in the model. For
 * the patient-facing progress card we therefore project a "planned visit
 * count" from the heuristics below (whichever is largest):
 *   - completed visits + 1 next booked visit
 *   - 1 (so a brand-new case still shows "0 of 1")
 *
 * If/when a doctor-supplied plan length is added (likely Phase 18), this
 * helper picks it up via the optional `plannedVisits` arg.
 */

export type TreatmentProgress = {
  /** 0..total */
  done: number;
  /** Always >= 1; equals max(plannedVisits, done + (nextBookedAt ? 1 : 0), 1). */
  total: number;
  /** ISO string of the next BOOKED appointment for this case, or null. */
  nextVisitAt: string | null;
  /** 0..1 — fraction of `total`. 0 when total is 0 (defensive). */
  progress: number;
  /** True when done >= total AND no nextVisitAt — i.e. "Лечение завершено". */
  completed: boolean;
  /** True when done == 0 AND nextVisitAt == null — render the "no plan" hint. */
  empty: boolean;
};

/**
 * Compute progress shape used by the <TreatmentPlanCard /> Mini App tile.
 *
 * Inputs are kept primitive (no Prisma types) so the helper is testable in
 * isolation. The route fetches the case, counts COMPLETED appointments,
 * picks the next BOOKED appointment, and forwards the values here.
 */
export function computeProgress(args: {
  plannedVisits?: number | null;
  completedAppointments: number;
  nextBookedAt: Date | string | null;
}): TreatmentProgress {
  const completed = Math.max(0, Math.floor(args.completedAppointments));
  const next = args.nextBookedAt
    ? typeof args.nextBookedAt === "string"
      ? args.nextBookedAt
      : args.nextBookedAt.toISOString()
    : null;

  // Project a sensible total when the case has no explicit plan length.
  const projectedTotal = completed + (next ? 1 : 0);
  const planned =
    typeof args.plannedVisits === "number" && args.plannedVisits > 0
      ? args.plannedVisits
      : 0;
  const total = Math.max(planned, projectedTotal, 1);

  const progress = total > 0 ? Math.min(1, completed / total) : 0;
  const completedAll = completed >= total && !next;
  const empty = completed === 0 && !next;

  return {
    done: completed,
    total,
    nextVisitAt: next,
    progress,
    completed: completedAll,
    empty,
  };
}
