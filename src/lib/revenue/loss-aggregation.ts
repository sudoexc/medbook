/**
 * Pure helpers for the Loss Analytics dashboard (Phase 14, Wave 3).
 *
 * The dashboard at /crm/analytics/loss aggregates revenue lost from three
 * sources over a date range. Aggregation logic lives here so it's testable
 * without spinning up Prisma:
 *
 *   - Empty slots          — pre-computed by `EmptySlotSnapshot` rows, summed
 *   - No-shows             — `Appointment.priceFinal` (or fallback) summed
 *                            for `status = 'NO_SHOW'`
 *   - Late cancellations   — same as no-shows but for `status = 'CANCELLED'`
 *                            and `cancelledAt within 24h of date`
 *
 * Dormant patients are a stock, not a flow (audit AN-17): how many patients
 * lapsed by now says nothing about what a week lost. They used to be one
 * entry worth the whole dormant base, dated on the period's first day, so
 * every week's chart opened with a spike the size of a month's revenue and
 * the period total carried it. `summarizeDormantStock` reports them apart.
 *
 * Every UZS amount is in **tiins** (minor units) and integer arithmetic only.
 * The page UI formats with `<MoneyText>` — these helpers return raw integers.
 *
 * Pure (only the client-safe Tashkent time helper is imported). Used by the
 * page server component AND by unit tests.
 */
import { SEGMENT_ACTIVE_DAYS } from "@/lib/patients/segment-rules";
import { tashkentPartsOf } from "@/lib/tashkent-time";

export type LossSource = "emptySlot" | "noShow" | "cancellation";

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
  total: number;
}

export interface DailyLossPoint {
  /** "YYYY-MM-DD" — one entry per day in `[from, to)`. */
  date: string;
  emptySlot: number;
  noShow: number;
  cancellation: number;
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
 * Convert a `Date` to a "YYYY-MM-DD" key in **Tashkent** (clinic time).
 * Mirrors the empty-slot engine's Tashkent-anchored snapshot dates so
 * comparisons line up, and buckets night appointments into the clinic's
 * civil day rather than the UTC one.
 */
export function toDateKey(d: Date): string {
  return tashkentPartsOf(d).date;
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
    total: 0,
  };
  for (const e of entries) {
    if (!isInRange(e.dateKey, fromKey, toKeyExcl)) continue;
    const amt = Math.max(0, Math.trunc(e.amountUzs));
    if (amt === 0) continue;
    if (e.source === "emptySlot") totals.emptySlot += amt;
    else if (e.source === "noShow") totals.noShow += amt;
    else if (e.source === "cancellation") totals.cancellation += amt;
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

export type DormantSegment = "recent_lapse" | "mid_lapse" | "deep_lapse";

export interface DormantSegmentRow {
  segment: DormantSegment;
  patientCount: number;
  /** Null when there is no honest per-patient value to multiply by. */
  estimatedRevenueUzs: number | null;
}

export interface DormantStock {
  /** Patients whose last completed visit is 90 days old or more, now. */
  patientCount: number;
  segments: DormantSegmentRow[];
  /** `patientCount × averageValueUzs`, null without a value. */
  estimatedRevenueUzs: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lapse bucket by days since the last visit, the reactivation engine's
 * bands (`classifyLapse`): 90 to 179, 180 to 365, over 365. Below 90 the
 * patient is not dormant (`SEGMENT_ACTIVE_DAYS`, the same line the patient
 * segments draw).
 */
export function dormantSegmentOf(daysSinceLastVisit: number): DormantSegment | null {
  if (!Number.isFinite(daysSinceLastVisit)) return null;
  if (daysSinceLastVisit < SEGMENT_ACTIVE_DAYS) return null;
  if (daysSinceLastVisit < 180) return "recent_lapse";
  if (daysSinceLastVisit <= 365) return "mid_lapse";
  return "deep_lapse";
}

/**
 * The dormant base as of `now`, from each candidate's last completed visit.
 * The caller drops patients with a visit booked ahead (they are coming).
 * Patients seen within the last 90 days are not dormant, whatever an old
 * `dormantSince` stamp says: that flag was never cleared, so a patient who
 * came back stayed «спящий» and his value stayed in the losses for good.
 */
export function summarizeDormantStock(
  lastVisits: ReadonlyArray<Date>,
  now: Date,
  averageValueUzs: number | null,
): DormantStock {
  const counts: Record<DormantSegment, number> = {
    recent_lapse: 0,
    mid_lapse: 0,
    deep_lapse: 0,
  };
  let patientCount = 0;
  for (const at of lastVisits) {
    const days = Math.floor((now.getTime() - at.getTime()) / DAY_MS);
    const segment = dormantSegmentOf(days);
    if (!segment) continue;
    counts[segment] += 1;
    patientCount += 1;
  }
  const value =
    averageValueUzs !== null && Number.isFinite(averageValueUzs) && averageValueUzs > 0
      ? Math.trunc(averageValueUzs)
      : null;
  return {
    patientCount,
    segments: (["recent_lapse", "mid_lapse", "deep_lapse"] as const).map(
      (segment) => ({
        segment,
        patientCount: counts[segment],
        estimatedRevenueUzs: value === null ? null : counts[segment] * value,
      }),
    ),
    estimatedRevenueUzs: value === null ? null : patientCount * value,
  };
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
