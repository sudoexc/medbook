/**
 * Pure aggregation helpers for the Phase 8a conversion-funnel KPIs.
 *
 * Each function takes already-fetched rows (so callers control the Prisma
 * query and `clinicId` scoping) and returns a JSON-serializable shape that
 * the API layer can pass through `ok(...)`.
 *
 * Why pure / no Prisma here? Two reasons:
 *   1. Unit tests can pass plain arrays without spinning up a DB.
 *   2. The API route stays a thin orchestrator (one file = one HTTP wiring).
 *
 * Window contract: callers pass `from` (inclusive) / `to` (exclusive),
 * matching `resolveAnalyticsRange`.
 *
 * NOTE on Mini-App booking funnel drop-off: not implemented. The codebase
 * doesn't track per-page-view events for `/api/miniapp/slots` or
 * `/api/miniapp/appointments POST` — there is no `MiniAppEvent` /
 * `FunnelEvent` table, and `Appointment` rows alone can't tell you how many
 * users *viewed* slots without booking. Implementing this would require
 * either (a) a new `MiniAppEvent { clinicId, kind, sessionId, createdAt }`
 * table and request-level instrumentation in the two miniapp routes, or
 * (b) parsing a server-side access log. Skipped intentionally; revisit when
 * we add an analytics events table.
 */
import { addDays, eachDay, ymdKey } from "./range";

export type ConversionWindow = { from: Date; to: Date };

// ── TG → Appointment ────────────────────────────────────────────────────────

export interface TgConversationInput {
  /** Conversation id (only used for stable de-dup if callers pass duplicates). */
  id: string;
  /** patientId resolved on the conversation (may be null — bot-only chats). */
  patientId: string | null;
  /** Earliest IN-direction message createdAt within the window. */
  firstInboundAt: Date;
}

export interface AppointmentForFunnelInput {
  patientId: string;
  /** Appointment.createdAt — when the booking happened (not the visit date). */
  createdAt: Date;
  /** Appointment.status — used to exclude CANCELLED. */
  status: string;
}

export interface FunnelDailyPoint {
  date: string;
  total: number;
  converted: number;
  /** rate = converted / total, 0 when total = 0. */
  rate: number;
}

export interface FunnelSummary {
  total: number;
  converted: number;
  rate: number;
  daily: FunnelDailyPoint[];
}

/**
 * Bucket appointments by patientId for fast lookup.
 * Each list is sorted ascending by createdAt for binary-search style scans.
 */
function indexAppointments(
  appointments: AppointmentForFunnelInput[],
): Map<string, AppointmentForFunnelInput[]> {
  const out = new Map<string, AppointmentForFunnelInput[]>();
  for (const a of appointments) {
    if (a.status === "CANCELLED") continue;
    const list = out.get(a.patientId);
    if (list) list.push(a);
    else out.set(a.patientId, [a]);
  }
  for (const list of out.values()) {
    list.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  }
  return out;
}

function withinDaysAfter(
  events: AppointmentForFunnelInput[] | undefined,
  reference: Date,
  days: number,
): boolean {
  if (!events || events.length === 0) return false;
  const refMs = reference.getTime();
  const cutoffMs = addDays(reference, days).getTime();
  for (const e of events) {
    const t = e.createdAt.getTime();
    if (t < refMs) continue;
    if (t > cutoffMs) return false; // sorted asc
    return true;
  }
  return false;
}

/**
 * TG → appointment conversion.
 *
 * Numerator: Conversations (in window) where the SAME-clinic patient booked
 * a non-CANCELLED Appointment within ≤`windowDays` days after the
 * conversation's first IN message.
 *
 * Denominator: all conversations with at least one IN message in the window.
 *
 * Conversations without a `patientId` count toward the denominator but
 * never the numerator (bot-only chats that never matched a patient).
 */
export function computeTgFunnel(args: {
  window: ConversionWindow;
  conversations: TgConversationInput[];
  appointments: AppointmentForFunnelInput[];
  windowDays?: number;
}): FunnelSummary {
  const windowDays = args.windowDays ?? 7;
  const apptByPatient = indexAppointments(args.appointments);

  const totalByDay = new Map<string, number>();
  const convertedByDay = new Map<string, number>();
  for (const d of eachDay(args.window.from, args.window.to)) {
    totalByDay.set(d, 0);
    convertedByDay.set(d, 0);
  }

  let total = 0;
  let converted = 0;
  for (const conv of args.conversations) {
    const k = ymdKey(conv.firstInboundAt);
    if (!totalByDay.has(k)) continue; // outside window
    total += 1;
    totalByDay.set(k, (totalByDay.get(k) ?? 0) + 1);
    if (
      conv.patientId &&
      withinDaysAfter(
        apptByPatient.get(conv.patientId),
        conv.firstInboundAt,
        windowDays,
      )
    ) {
      converted += 1;
      convertedByDay.set(k, (convertedByDay.get(k) ?? 0) + 1);
    }
  }

  const daily: FunnelDailyPoint[] = [...totalByDay.entries()].map(
    ([date, t]) => {
      const c = convertedByDay.get(date) ?? 0;
      return { date, total: t, converted: c, rate: t > 0 ? c / t : 0 };
    },
  );

  return {
    total,
    converted,
    rate: total > 0 ? converted / total : 0,
    daily,
  };
}

// ── Call → Appointment ──────────────────────────────────────────────────────

export interface CallForFunnelInput {
  /** Call id (de-dup helper). */
  id: string;
  patientId: string | null;
  /** Call.createdAt — anchor for the ≤7-day lookahead. */
  createdAt: Date;
  /** "completed-equivalent" — caller decides (e.g. direction !== MISSED && durationSec > 0). */
  completed: boolean;
}

/**
 * Call → appointment conversion. Same shape as TG funnel.
 *
 * Numerator: Calls (in window, completed) whose `patientId` booked a
 * non-CANCELLED Appointment within ≤`windowDays` days after the call.
 *
 * Denominator: all completed calls in the window.
 */
export function computeCallFunnel(args: {
  window: ConversionWindow;
  calls: CallForFunnelInput[];
  appointments: AppointmentForFunnelInput[];
  windowDays?: number;
}): FunnelSummary {
  const windowDays = args.windowDays ?? 7;
  const apptByPatient = indexAppointments(args.appointments);

  const totalByDay = new Map<string, number>();
  const convertedByDay = new Map<string, number>();
  for (const d of eachDay(args.window.from, args.window.to)) {
    totalByDay.set(d, 0);
    convertedByDay.set(d, 0);
  }

  let total = 0;
  let converted = 0;
  for (const call of args.calls) {
    if (!call.completed) continue;
    const k = ymdKey(call.createdAt);
    if (!totalByDay.has(k)) continue;
    total += 1;
    totalByDay.set(k, (totalByDay.get(k) ?? 0) + 1);
    if (
      call.patientId &&
      withinDaysAfter(
        apptByPatient.get(call.patientId),
        call.createdAt,
        windowDays,
      )
    ) {
      converted += 1;
      convertedByDay.set(k, (convertedByDay.get(k) ?? 0) + 1);
    }
  }

  const daily: FunnelDailyPoint[] = [...totalByDay.entries()].map(
    ([date, t]) => {
      const c = convertedByDay.get(date) ?? 0;
      return { date, total: t, converted: c, rate: t > 0 ? c / t : 0 };
    },
  );

  return {
    total,
    converted,
    rate: total > 0 ? converted / total : 0,
    daily,
  };
}

// ── No-show by doctor / by service ─────────────────────────────────────────

export interface NoShowAppointmentInput {
  doctorId: string;
  /** `serviceId` (primary). May be null for legacy rows. */
  serviceId: string | null;
  /** Only `COMPLETED` and `NO_SHOW` rows are considered. */
  status: "COMPLETED" | "NO_SHOW" | string;
}

export interface NoShowRankRow {
  /** doctorId or serviceId. */
  id: string;
  noShow: number;
  completed: number;
  total: number;
  rate: number;
}

function rankNoShow(
  byKey: Map<string, { noShow: number; completed: number }>,
  limit: number,
): NoShowRankRow[] {
  const rows: NoShowRankRow[] = [];
  for (const [id, v] of byKey.entries()) {
    const total = v.noShow + v.completed;
    if (total === 0) continue;
    rows.push({
      id,
      noShow: v.noShow,
      completed: v.completed,
      total,
      rate: v.noShow / total,
    });
  }
  // Sort: rate desc, then total desc to break ties (more data = more confident).
  rows.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    return b.total - a.total;
  });
  return rows.slice(0, limit);
}

export function computeNoShowRanks(args: {
  appointments: NoShowAppointmentInput[];
  limit?: number;
}): { byDoctor: NoShowRankRow[]; byService: NoShowRankRow[] } {
  const limit = args.limit ?? 10;
  const byDoctor = new Map<string, { noShow: number; completed: number }>();
  const byService = new Map<string, { noShow: number; completed: number }>();

  for (const a of args.appointments) {
    if (a.status !== "COMPLETED" && a.status !== "NO_SHOW") continue;
    const isNoShow = a.status === "NO_SHOW";

    const dkey = a.doctorId;
    const dRec = byDoctor.get(dkey) ?? { noShow: 0, completed: 0 };
    if (isNoShow) dRec.noShow += 1;
    else dRec.completed += 1;
    byDoctor.set(dkey, dRec);

    if (a.serviceId) {
      const sRec = byService.get(a.serviceId) ?? { noShow: 0, completed: 0 };
      if (isNoShow) sRec.noShow += 1;
      else sRec.completed += 1;
      byService.set(a.serviceId, sRec);
    }
  }

  return {
    byDoctor: rankNoShow(byDoctor, limit),
    byService: rankNoShow(byService, limit),
  };
}

// ── Average wait time per doctor ───────────────────────────────────────────

export interface WaitTimeAppointmentInput {
  doctorId: string;
  /** When the receptionist clicked "Call patient" — start of waiting → in-progress timer. */
  calledAt: Date | null;
  /** When the doctor began the visit. */
  startedAt: Date | null;
}

export interface WaitTimeRow {
  doctorId: string;
  /** Average wait, in seconds. */
  avgWaitSec: number;
  /** Number of `(calledAt, startedAt)` pairs that contributed. */
  samples: number;
}

/**
 * Per-doctor average of `(startedAt - calledAt)` in seconds.
 *
 * Skips appointments where either timestamp is null or the delta is
 * negative (data corruption guard). Sorts result descending by avg wait —
 * worst doctors first so the dashboard surfaces problems.
 */
export function computeAverageWaitTime(args: {
  appointments: WaitTimeAppointmentInput[];
}): WaitTimeRow[] {
  const totals = new Map<string, { sumSec: number; samples: number }>();
  for (const a of args.appointments) {
    if (!a.calledAt || !a.startedAt) continue;
    const deltaMs = a.startedAt.getTime() - a.calledAt.getTime();
    if (deltaMs < 0) continue;
    const rec = totals.get(a.doctorId) ?? { sumSec: 0, samples: 0 };
    rec.sumSec += Math.round(deltaMs / 1000);
    rec.samples += 1;
    totals.set(a.doctorId, rec);
  }
  const out: WaitTimeRow[] = [];
  for (const [doctorId, v] of totals.entries()) {
    if (v.samples === 0) continue;
    out.push({
      doctorId,
      avgWaitSec: Math.round(v.sumSec / v.samples),
      samples: v.samples,
    });
  }
  out.sort((a, b) => b.avgWaitSec - a.avgWaitSec);
  return out;
}
