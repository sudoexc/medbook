/**
 * The reception dashboard's live counters (audit UX-02), derived from the
 * dashboard's per-`queueStatus` buckets for today.
 *
 * The strip used to mislabel two of them. «В очереди сейчас» added BOOKED and
 * CONFIRMED to WAITING, so at 9:00 the desk read 42 people in a hall of 3:
 * every booking of the day, the 17:00 ones and the ones who never came
 * included. «Прибыли сегодня» showed the COMPLETED count, so ten patients in
 * the building read as zero until the first visit closed.
 *
 * Client-safe: no server imports.
 */

/** One `queueStatus` bucket of the dashboard's snapshot. */
export interface QueueBucket {
  status: string;
  count: number;
}

/**
 * Where a patient who checked in can be later in the day: waiting, skipped
 * at the call (still here, may come back), on the table, or seen.
 */
export const ARRIVED_QUEUE_STATUSES = [
  "WAITING",
  "SKIPPED",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

export interface ReceptionQueueKpis {
  /** Physically in the waiting room right now. */
  waitingNow: number;
  /** Checked in today, whatever happened to them since. */
  arrived: number;
  inProgress: number;
  completed: number;
  noShow: number;
}

export function receptionQueueKpis(
  buckets: ReadonlyArray<QueueBucket> | undefined,
): ReceptionQueueKpis {
  const count = (status: string): number => {
    let n = 0;
    for (const b of buckets ?? []) if (b.status === status) n += b.count;
    return n;
  };
  return {
    waitingNow: count("WAITING"),
    arrived: ARRIVED_QUEUE_STATUSES.reduce((n, s) => n + count(s), 0),
    inProgress: count("IN_PROGRESS"),
    completed: count("COMPLETED"),
    noShow: count("NO_SHOW"),
  };
}

/**
 * Clinic revenue is for the roles the financial dashboard admits
 * (`/crm/analytics/financial` answers 404 to everyone else). The desk's
 * revenue tile linked there, so a receptionist clicking it landed on a 404.
 */
export function canSeeClinicRevenue(role: string): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}
