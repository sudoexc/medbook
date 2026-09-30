/**
 * The clinic-wide patient segments (audit PT-15): «Новые», «Активные»,
 * «Остывают», «Потерянные», and the manual «VIP».
 *
 * `Patient.segment` was written once, NEW at registration, and never again.
 * Every patient stayed «Новый» for good: the «Новые» tab was the whole base,
 * «Активные» and «Остывают» were empty, the «Спящие» tile opened an empty
 * page, and a Telegram broadcast to «Активные» reached nobody while one to
 * «Новые» reached everyone. The segment is now recomputed from the visit
 * history by one rule, on every completed visit and by a periodic job
 * (`server/patient/segments.ts`, `workers/patient-segments.ts`).
 *
 * The rule, from the completed visits (`visitsCount`, `lastVisitAt`, kept
 * by `refreshPatientVisitStats`) and the registration date:
 *   VIP        set by hand and never changed by the rule;
 *   NEW        a first-timer: no completed visit yet and registered within
 *              the last 90 days, or exactly one visit within the last 90;
 *   ACTIVE     two visits or more, the last within the last 90 days;
 *   DORMANT    «Остывают»: the last visit 91 to 365 days ago;
 *   CHURN      «Потерянные»: the last visit over a year ago, or registered
 *              over 90 days ago and never seen.
 * 90 days is the same line the reactivation detector draws for «давно не
 * был» (dormant-batch starts at 90), so «Остывают» and the reactivation
 * lists name the same patients; a neurology control visit usually falls
 * inside it, so a patient who keeps coming back stays «Активный».
 *
 * Pure and dependency-free: the server, the client and the data-fix script
 * all import it.
 */

export type PatientSegmentValue = "NEW" | "ACTIVE" | "DORMANT" | "VIP" | "CHURN";

/** A first-timer stays «Новый» this long. */
export const SEGMENT_NEW_DAYS = 90;
/** The last visit within this many days keeps a returning patient active. */
export const SEGMENT_ACTIVE_DAYS = 90;
/** Past this many days without a visit the patient is counted as lost. */
export const SEGMENT_DORMANT_MAX_DAYS = 365;

const DAY_MS = 86_400_000;

function daysBetween(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / DAY_MS);
}

export interface SegmentInput {
  current: PatientSegmentValue;
  /** Completed visits. */
  visitsCount: number;
  lastVisitAt: Date | null;
  createdAt: Date;
}

export function classifyPatientSegment(
  input: SegmentInput,
  now: Date,
): PatientSegmentValue {
  if (input.current === "VIP") return "VIP";
  if (input.visitsCount <= 0 || !input.lastVisitAt) {
    return daysBetween(input.createdAt, now) <= SEGMENT_NEW_DAYS ? "NEW" : "CHURN";
  }
  const since = daysBetween(input.lastVisitAt, now);
  if (since > SEGMENT_DORMANT_MAX_DAYS) return "CHURN";
  if (since > SEGMENT_ACTIVE_DAYS) return "DORMANT";
  return input.visitsCount >= 2 ? "ACTIVE" : "NEW";
}

/** The patients whose stored segment differs from the rule, grouped by target. */
export function segmentChanges<T extends SegmentInput & { id: string }>(
  rows: ReadonlyArray<T>,
  now: Date,
): Map<PatientSegmentValue, string[]> {
  const out = new Map<PatientSegmentValue, string[]>();
  for (const r of rows) {
    const next = classifyPatientSegment(r, now);
    if (next === r.current) continue;
    const list = out.get(next) ?? [];
    list.push(r.id);
    out.set(next, list);
  }
  return out;
}
