/**
 * Numbering and counting the visits of a medical case (audit PT-16).
 *
 * The case page, the printed «Карта случая» and the visit drawer numbered
 * visits by their index among ALL the case's appointments. A patient who
 * cancelled on 01.09 and came on 03.09 had the 03.09 visit printed as
 * «Повторный (2-я)», while the pricing engine, rightly, charged it as the
 * first visit. A cancelled visit or a no-show never happened: it gets no
 * number, is never «Первичный», and costs nothing. Same rule as
 * `recompute-appointment-price.ts`, which decides the free-repeat price.
 *
 * Money follows `src/lib/patients/finance.ts`: only COMPLETED visits cost
 * (a future booking is not «начислено»).
 *
 * Client-safe: no server imports.
 */
import { BILLABLE_VISIT_STATUS } from "@/lib/patients/finance";

/** Visits that never happened. */
export const NOT_HELD_VISIT_STATUSES = ["CANCELLED", "NO_SHOW"] as const;

const NOT_HELD: ReadonlySet<string> = new Set(NOT_HELD_VISIT_STATUSES);

/** Whether a visit takes a place in the case's numbering. */
export function isNumberedCaseVisit(status: string): boolean {
  return !NOT_HELD.has(status);
}

/**
 * The Prisma filter for the case siblings one visit is numbered among (the
 * visit drawer's «Повторный (N-й)»): the visits that took or take place,
 * plus the visit itself even when it was cancelled, so it still reads
 * where it stood. The pricing engine anchors «first visit» the same way.
 */
export function numberedSiblingsWhere(medicalCaseId: string, selfId: string) {
  return {
    medicalCaseId,
    OR: [
      { id: selfId },
      { status: { notIn: [...NOT_HELD_VISIT_STATUSES] } },
    ],
  };
}

/**
 * The visit number per appointment id («1» is «Первичный»), null for a
 * visit that never happened. `rows` must be in timeline order: date, then
 * creation, then id, as the case endpoints return them.
 */
export function caseVisitOrdinals(
  rows: ReadonlyArray<{ id: string; status: string }>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  let n = 0;
  for (const row of rows) {
    if (isNumberedCaseVisit(row.status)) {
      n += 1;
      out.set(row.id, n);
    } else {
      out.set(row.id, null);
    }
  }
  return out;
}

export type CaseVisitRow = {
  id: string;
  status: string;
  priceFinal: number | null;
};

export type CaseVisitStats = {
  /** Visits that take a number: everything but cancelled and no-show. */
  numberedVisits: number;
  /** COMPLETED visits. */
  completedVisits: number;
  /** Sum of `priceFinal` over COMPLETED visits, тийин. */
  completedTotal: number;
  /** COMPLETED repeat visits the patient was not charged for. */
  freeRepeats: number;
};

export function caseVisitStats(
  rows: ReadonlyArray<CaseVisitRow>,
): CaseVisitStats {
  const ordinals = caseVisitOrdinals(rows);
  let numberedVisits = 0;
  let completedVisits = 0;
  let completedTotal = 0;
  let freeRepeats = 0;
  for (const row of rows) {
    const n = ordinals.get(row.id) ?? null;
    if (n !== null) numberedVisits += 1;
    if (row.status !== BILLABLE_VISIT_STATUS) continue;
    completedVisits += 1;
    completedTotal += row.priceFinal ?? 0;
    if (n !== null && n > 1 && row.priceFinal === 0) freeRepeats += 1;
  }
  return { numberedVisits, completedVisits, completedTotal, freeRepeats };
}
