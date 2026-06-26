/**
 * Single source of truth for live-queue ordering — shared verbatim by the
 * server projection (`queue-projection`, driving the TV board / kiosk / patient
 * ticket) and every client sort site (reception panel, doctor list, queue
 * column). Before this lived in one place the server sorted by `queueOrder` and
 * the reception panel by a different `queueOrder`-then-`date` rule that even
 * disagreed on which way null `queueOrder` rows fell — so the same patient
 * showed up at the head of the public board and the tail of the staff panel.
 *
 * The model is earliest-deadline-first on a single axis, `serveAt`:
 *
 *   - A walk-in is served FIFO by the moment it joined the queue (`queuedAt`).
 *   - A scheduled visit is served at `max(slot, queuedAt)` — at its slot if it
 *     arrived on time, but never before it actually arrived. A booking that
 *     checks in late is therefore treated as a walk-in from its arrival and
 *     can't jump the people who waited for it.
 *
 * `queuePriority` is the one manual override (the reception "срочно" bump) and
 * sits above `serveAt`. `ticketSeq` is the stable, immutable tiebreak so two
 * rows with an identical `serveAt` never swap and churn their ticket numbers.
 */

/** Anything orderable in the live queue. Dates accept Date | ISO string | ms. */
export interface QueueOrderable {
  queuePriority: number;
  /** Appointment.channel — only "WALKIN" changes the serveAt formula. */
  channel: string;
  /** Scheduled slot start for bookings; arrival "now" for walk-ins. */
  date: Date | string | number;
  /** When the row entered WAITING. Null falls back to `date`. */
  queuedAt: Date | string | number | null;
  ticketSeq?: number | null;
  queueOrder?: number | null;
}

function ms(v: Date | string | number): number {
  if (typeof v === "number") return v;
  return (typeof v === "string" ? new Date(v) : v).getTime();
}

/** The instant this visit should be served — the EDF key. */
export function serveAtMs(
  a: Pick<QueueOrderable, "channel" | "date" | "queuedAt">,
): number {
  const scheduled = ms(a.date);
  const queued = a.queuedAt == null ? scheduled : ms(a.queuedAt);
  return a.channel === "WALKIN" ? queued : Math.max(scheduled, queued);
}

/**
 * The one true live-queue comparator: urgency bump first, then serveAt (EDF),
 * then the immutable ticket sequence so equal-serveAt rows stay put.
 */
export function compareQueue(a: QueueOrderable, b: QueueOrderable): number {
  if (a.queuePriority !== b.queuePriority) return b.queuePriority - a.queuePriority;
  const sa = serveAtMs(a);
  const sb = serveAtMs(b);
  if (sa !== sb) return sa - sb;
  const ta = a.ticketSeq ?? a.queueOrder ?? Number.MAX_SAFE_INTEGER;
  const tb = b.ticketSeq ?? b.queueOrder ?? Number.MAX_SAFE_INTEGER;
  return ta - tb;
}
