/**
 * The tiles above the «Записи» table (audit AP-21), defined once for the
 * server, which counts them over the whole filter set, and for the client,
 * which narrows the loaded rows when a tile is picked.
 *
 * The tiles used to be tallied from the rows already loaded (one page of
 * 50), so on a busy day «Не подтверждены: 12» stood for 25 real ones, and a
 * tile that set a status filter zeroed every other tile. Their hints did not
 * match the formulas either: «В ближайший час» counted 15 minutes, «Прибыли»
 * left out the patients sitting in the hall. Pure and client-safe.
 */
import {
  OVERDUE_CANDIDATE_STATUS_LIST,
  OVERDUE_GRACE_MIN,
} from "@/lib/appointments/overdue";

/** «Скоро»: a booking that starts within this many minutes from now. */
export const SOON_WINDOW_MIN = 15;

/** Bookings that can still be «скоро»: the patient has not arrived yet. */
export const SOON_STATUSES = ["BOOKED", "CONFIRMED"] as const;

/** «Прибыли»: in the hall, at the doctor's, or already seen. */
export const ARRIVED_STATUSES = ["WAITING", "IN_PROGRESS", "COMPLETED"] as const;

/**
 * Prisma `where` clauses for the two tiles that depend on the clock, the
 * same predicates as `isOverdue` and the «скоро» narrowing of the loaded
 * rows. The route ANDs each with the list's filters.
 */
export function timedTileWheres(now: Date): {
  soon: Record<string, unknown>;
  overdue: Record<string, unknown>;
} {
  const nowMs = now.getTime();
  return {
    soon: {
      status: { in: [...SOON_STATUSES] },
      date: { gte: now, lte: new Date(nowMs + SOON_WINDOW_MIN * 60_000) },
    },
    overdue: {
      status: { in: [...OVERDUE_CANDIDATE_STATUS_LIST] },
      endDate: { lt: new Date(nowMs - OVERDUE_GRACE_MIN * 60_000) },
    },
  };
}

export type ListTileCounts = {
  all: number;
  needsAttention: number;
  soon: number;
  unconfirmed: number;
  overdue: number;
  arrived: number;
};

/**
 * The tiles from the list response's `tally`: per-status counts over every
 * filter but the status (so picking a tile does not zero the others), plus
 * the server's `soon` and `overdue`. «Срочные» is the hall plus the overdue
 * (a WAITING row is never overdue, so nobody is counted twice).
 */
export function tilesFromTally(
  tally: Record<string, number> | null | undefined,
): ListTileCounts {
  const n = (k: string) => tally?.[k] ?? 0;
  const overdue = n("overdue");
  return {
    all: n("all"),
    needsAttention: n("WAITING") + overdue,
    soon: n("soon"),
    unconfirmed: n("BOOKED"),
    overdue,
    arrived: ARRIVED_STATUSES.reduce((sum, s) => sum + n(s), 0),
  };
}
