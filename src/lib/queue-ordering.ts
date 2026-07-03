/**
 * Single source of truth for live-queue ordering — shared verbatim by the
 * server projection (`queue-projection`, driving the TV board / kiosk / patient
 * ticket) and every client sort site (reception panel, doctor list, queue
 * column).
 *
 * TWO-LANES MODEL (docs/TZ-two-lanes.md, replaces the serveAt EDF model):
 *
 *   - LIVE lane   = walk-ins (`channel === "WALKIN"`). Timeless FIFO — the
 *     order depends only on (queuePriority, queuedAt, ticketSeq). The row's
 *     `date` window is a technical field (calendar day / DB non-null), it
 *     NEVER affects queue position.
 *   - SCHEDULE lane = bookings (any other channel). Pure slot semantics —
 *     they never enter the live queue's order, no matter when they check in.
 *     An arrived booking is an "arrived" state inside the schedule lane; the
 *     doctor starts it explicitly, next to (not inside) the live queue.
 *
 * `queuePriority` is the one manual override (the reception «срочно» bump)
 * and sits above arrival order. `ticketSeq` is the stable, immutable tiebreak
 * so two rows with an identical `queuedAt` never swap and churn tickets.
 */

/** Anything orderable in the live queue. Dates accept Date | ISO string | ms. */
export interface QueueOrderable {
  queuePriority: number;
  /** Appointment.channel — "WALKIN" is the live lane, everything else is a booking. */
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

/** LIVE lane = walk-ins. Bookings (PHONE/TELEGRAM/WEBSITE/KIOSK) never enter it. */
export function isLiveLane(a: Pick<QueueOrderable, "channel">): boolean {
  return a.channel === "WALKIN";
}

/**
 * The FIFO key of the live lane: the moment the row joined the queue.
 * `date` is only a safety fallback for legacy rows that predate `queuedAt` —
 * slot times deliberately play no role in the order (I1 of the TZ).
 */
export function queuedMs(
  a: Pick<QueueOrderable, "date" | "queuedAt">,
): number {
  return a.queuedAt == null ? ms(a.date) : ms(a.queuedAt);
}

/**
 * The one true live-queue comparator: urgency bump first, then arrival FIFO,
 * then the immutable ticket sequence so equal-arrival rows stay put.
 */
export function compareQueue(a: QueueOrderable, b: QueueOrderable): number {
  if (a.queuePriority !== b.queuePriority) return b.queuePriority - a.queuePriority;
  const sa = queuedMs(a);
  const sb = queuedMs(b);
  if (sa !== sb) return sa - sb;
  const ta = a.ticketSeq ?? a.queueOrder ?? Number.MAX_SAFE_INTEGER;
  const tb = b.ticketSeq ?? b.queueOrder ?? Number.MAX_SAFE_INTEGER;
  return ta - tb;
}

/**
 * Split a mixed row set into the two independent lanes. `live` comes back
 * sorted by `compareQueue`; `schedule` keeps the caller's order (callers sort
 * bookings by slot time themselves — that axis belongs to the calendar).
 */
export function splitLanes<T extends QueueOrderable>(
  rows: T[],
): { live: T[]; schedule: T[] } {
  const live: T[] = [];
  const schedule: T[] = [];
  for (const r of rows) (isLiveLane(r) ? live : schedule).push(r);
  live.sort(compareQueue);
  return { live, schedule };
}
