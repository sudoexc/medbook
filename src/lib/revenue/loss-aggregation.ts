/**
 * Pure helpers for the Loss Analytics dashboard (Phase 14, Wave 3).
 *
 * The dashboard at /crm/analytics/loss aggregates revenue lost from four
 * sources over a date range. Aggregation logic lives here so it's testable
 * without spinning up Prisma:
 *
 *   - Empty slots          — pre-computed by `EmptySlotSnapshot` rows, summed
 *   - No-shows             — `Appointment.priceFinal` (or fallback) summed
 *                            for `status = 'NO_SHOW'`
 *   - Late cancellations   — same as no-shows but for `status = 'CANCELLED'`
 *                            and `cancelledAt within 24h of date`
 *   - Dormant patients     — count(dormantSince != null) × avg lifetime visit
 *                            value (a conservative payment-based estimate)
 *
 * Every UZS amount is in **tiins** (minor units) and integer arithmetic only.
 * The page UI formats with `<MoneyText>` — these helpers return raw integers.
 *
 * Pure: zero imports. Used by the page server component AND by unit tests.
 */

export type LossSource = "emptySlot" | "noShow" | "cancellation" | "dormant";

/** A single loss data-point — `dateKey` is "YYYY-MM-DD" (clinic-local TZ). */
export interface LossEntry {
  /** ISO calendar day key, "YYYY-MM-DD". */
  dateKey: string;
  source: LossSource;
  /** UZS tiins. Negative values are clamped to 0 inside totals. */
  amountUzs: number;
}

export interface LossTotals {
  emptySlot: number;
  noShow: number;
  cancellation: number;
  dormant: number;
  total: number;
}

export interface DailyLossPoint {
  /** "YYYY-MM-DD" — one entry per day in `[from, to)`. */
  date: string;
  emptySlot: number;
  noShow: number;
  cancellation: number;
  dormant: number;
}

/**
 * `dateKey` is "YYYY-MM-DD". Returns true when it falls in `[fromKey, toKeyExcl)`.
 *
 * String comparison works because the format is lexicographically ordered.
 */
function isInRange(dateKey: string, fromKey: string, toKeyExcl: string): boolean {
  return dateKey >= fromKey && dateKey < toKeyExcl;
}

/**
 * Convert a `Date` to a "YYYY-MM-DD" key in UTC. Mirrors the engine's
 * UTC-anchored snapshot dates so comparisons line up.
 */
export function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Each calendar day in `[fromKey, toKeyExcl)`, inclusive..exclusive. */
export function eachDateKey(fromKey: string, toKeyExcl: string): string[] {
  const out: string[] = [];
  if (fromKey >= toKeyExcl) return out;
  // Parse as UTC midnight to avoid TZ drift over month/year boundaries.
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKeyExcl.split("-").map(Number);
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));
  while (cur < end) {
    out.push(toDateKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Sum loss entries by source over a date window.
 *
 *   - Entries whose `dateKey` is outside `[fromKey, toKeyExcl)` are dropped
 *   - Negative `amountUzs` is treated as 0 (loss is non-negative)
 *   - Unknown source values are ignored
 */
export function aggregateLoss(
  entries: ReadonlyArray<LossEntry>,
  fromKey: string,
  toKeyExcl: string,
): LossTotals {
  const totals: LossTotals = {
    emptySlot: 0,
    noShow: 0,
    cancellation: 0,
    dormant: 0,
    total: 0,
  };
  for (const e of entries) {
    if (!isInRange(e.dateKey, fromKey, toKeyExcl)) continue;
    const amt = Math.max(0, Math.trunc(e.amountUzs));
    if (amt === 0) continue;
    if (e.source === "emptySlot") totals.emptySlot += amt;
    else if (e.source === "noShow") totals.noShow += amt;
    else if (e.source === "cancellation") totals.cancellation += amt;
    else if (e.source === "dormant") totals.dormant += amt;
    else continue;
    totals.total += amt;
  }
  return totals;
}

/**
 * Build a per-day series for the stacked area chart. Days with no loss
 * appear with all-zero amounts so the X-axis stays gap-free.
 */
export function aggregateDaily(
  entries: ReadonlyArray<LossEntry>,
  fromKey: string,
  toKeyExcl: string,
): DailyLossPoint[] {
  const days = eachDateKey(fromKey, toKeyExcl);
  const map = new Map<string, DailyLossPoint>();
  for (const d of days) {
    map.set(d, {
      date: d,
      emptySlot: 0,
      noShow: 0,
      cancellation: 0,
      dormant: 0,
    });
  }
  for (const e of entries) {
    const point = map.get(e.dateKey);
    if (!point) continue; // outside range
    const amt = Math.max(0, Math.trunc(e.amountUzs));
    if (amt === 0) continue;
    if (e.source === "emptySlot") point.emptySlot += amt;
    else if (e.source === "noShow") point.noShow += amt;
    else if (e.source === "cancellation") point.cancellation += amt;
    else if (e.source === "dormant") point.dormant += amt;
  }
  return days.map((d) => map.get(d)!);
}

/**
 * Estimate the per-patient lifetime visit value used to value dormant
 * patients. The math is intentionally conservative:
 *
 *   avg = sum(payments) / max(activePatients, 1)
 *
 * If the clinic has very few active patients, the estimate skews up — that's
 * fine; the dormant card is a "revenue at risk" estimate, not an invoice.
 *
 * Returns 0 when no payments are observed (avoids dividing by zero).
 */
export function estimateAverageVisitValue(args: {
  totalPaymentsUzs: number;
  activePatientCount: number;
}): number {
  const total = Math.max(0, Math.trunc(args.totalPaymentsUzs));
  const denom = Math.max(1, args.activePatientCount);
  return Math.round(total / denom);
}

/**
 * A "late" cancellation is one cancelled within 24 hours of its scheduled
 * start. Cancellations earlier than that are treated as low-loss optionality
 * — we don't count them.
 */
export function isLateCancellation(args: {
  startsAt: Date;
  cancelledAt: Date | null;
}): boolean {
  if (!args.cancelledAt) return false;
  const diffMs = args.startsAt.getTime() - args.cancelledAt.getTime();
  // Late = cancellation happened in the last 24h leading up to the start.
  // Negative diffs (cancelled after start) also count — that's a no-show in
  // disguise but the schema doesn't enforce status consistency, so we err
  // on the side of counting it.
  return diffMs <= 24 * 60 * 60 * 1000;
}
