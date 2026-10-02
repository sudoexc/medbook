/**
 * The tiles above the «Записи» table (audit AP-21), defined once for the
 * server, which counts them over the whole filter set and filters the list
 * by the tile picked, and for the client, which renders the counts.
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
 * Prisma `where` clauses for the two tiles that depend on the clock
 * («просрочены» is the same predicate as `isOverdue`). The route ANDs each
 * with the list's filters.
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

/**
 * The tiles that are not one status. The list route filters them on the
 * server (`bucket=`), so a tile's click shows every row its count holds:
 * narrowing only the loaded page left «Скоро: 3» over an empty table with
 * no «Загрузить ещё» when those rows sat past the first 50.
 */
export const SERVER_BUCKETS = [
  "needs_attention",
  "soon",
  "overdue",
  "arrived",
  "late",
] as const;

export type ServerBucket = (typeof SERVER_BUCKETS)[number];

export function isServerBucket(v: string | null | undefined): v is ServerBucket {
  return v != null && (SERVER_BUCKETS as readonly string[]).includes(v);
}

/**
 * Prisma `where` for a server bucket, the same predicate the tile counts
 * (and, for «опаздывают», `isRunningLate`). The route ANDs it with the
 * list's filters and leaves it out of the tally, so the other tiles keep
 * their numbers while one is picked.
 */
export function bucketWhere(
  bucket: ServerBucket,
  now: Date,
): Record<string, unknown> {
  const timed = timedTileWheres(now);
  switch (bucket) {
    case "soon":
      return timed.soon;
    case "overdue":
      return timed.overdue;
    case "arrived":
      return { status: { in: [...ARRIVED_STATUSES] } };
    case "needs_attention":
      // «Срочные» = the hall + the overdue, as `tilesFromTally` adds them.
      return { OR: [{ status: "WAITING" }, timed.overdue] };
    case "late":
      // Started, but still inside the window plus the grace.
      return {
        status: { in: [...OVERDUE_CANDIDATE_STATUS_LIST] },
        date: { lt: now },
        endDate: { gte: new Date(now.getTime() - OVERDUE_GRACE_MIN * 60_000) },
      };
  }
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
