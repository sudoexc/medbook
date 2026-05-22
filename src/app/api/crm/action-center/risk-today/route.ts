/**
 * /api/crm/action-center/risk-today — curated triage for the day.
 *
 * Returns ONE row per at-risk appointment scheduled in the clinic's local
 * "today" window. An appointment is "at risk" if it has any of:
 *
 *   - an open NO_SHOW_RISK_HIGH action (`risk` carries the score)
 *   - an open UNCONFIRMED_24H action (patient hasn't confirmed and start
 *     is inside the unconfirmed look-ahead window)
 *   - patient.lastContactedAt is null OR older than 14 days
 *
 * One appointment can carry multiple reasons — they collapse onto a single
 * row with a `reasons[]` array and a composite `riskScore` for sorting and
 * visual gauges. Without this dedupe the same patient was being counted in
 * both the "threat" KPI and the "noShow" KPI; that's exactly the duplication
 * we are getting rid of with this surface.
 *
 * Sort: by `appointmentAt ASC` (timeline order). Receptionists work the day
 * top-to-bottom; pure risk-DESC would jump them around chronologically.
 *
 * Status filter: only BOOKED|WAITING|IN_PROGRESS. Once an appointment is
 * COMPLETED / CANCELLED / NO_SHOW / SKIPPED it's no longer actionable, so it
 * drops off the triage even if its Action rows are still hanging around for
 * audit.
 *
 * Tenant scoping: the Prisma extension already injects `clinicId` into every
 * relevant model. We only need an explicit clinic fetch to read `timezone`.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import type {
  ActionPayload,
  NoShowRiskHighPayload,
  Unconfirmed24hPayload,
} from "@/lib/actions/types";

export type RiskReason =
  | { kind: "high_risk"; risk: number }
  | { kind: "unconfirmed_24h"; hoursToAppt: number }
  | { kind: "no_contact"; daysSinceContact: number | null };

export type RiskTodayRow = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentAt: string;
  doctorName: { ru: string; uz: string };
  serviceName: { ru: string; uz: string } | null;
  priceFinalTiins: number | null;
  status: "BOOKED" | "WAITING" | "IN_PROGRESS";
  reasons: RiskReason[];
  riskScore: number;
  actionIds: string[];
};

export type RiskTodayResponse = {
  appointments: RiskTodayRow[];
  totals: {
    total: number;       // open + handledToday
    open: number;        // = appointments.length
    handledToday: number;
    estimatedLossTiins: number;
  };
  windowStart: string;
  windowEnd: string;
};

// Days since last contact that pushes a patient onto the triage list. Mirrors
// the chip threshold on the patient hero so the two surfaces tell the same
// story.
const NO_CONTACT_DAYS = 14;
// Floor for the no-contact reason's contribution to riskScore. Tunes how
// "loudly" the dormant signal speaks compared to a hard NO_SHOW_RISK_HIGH.
const NO_CONTACT_RISK_FLOOR = 0.4;
// Cap so a 365-day no-contact never out-shouts a 95% no-show risk.
const NO_CONTACT_RISK_CEILING = 0.7;
// Base score for an unconfirmed-24h reason. Sits between low/high so the
// signal triggers a UI nudge without dominating no-show predictions.
const UNCONFIRMED_RISK_BASE = 0.6;
// Default expected loss multiplier when an appointment has no priceFinal set
// (e.g. a brand-new booking awaiting service catalog assignment).
const FALLBACK_PRICE_TIINS = 8_000_000; // 80,000 UZS — matches AVG_VISIT_TIINS on the client

function clinicTodayBounds(now: Date, tz: string): { start: Date; end: Date } {
  // Resolve the clinic's local calendar date and TZ offset at `now`, then
  // back-solve the UTC instant of midnight in that TZ. Using only standard
  // Intl APIs to avoid adding `date-fns-tz` for one helper.
  let y: string | undefined;
  let m: string | undefined;
  let d: string | undefined;
  let offName: string | undefined;
  try {
    const dateParts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).formatToParts(now);
    y = dateParts.find((p) => p.type === "year")?.value;
    m = dateParts.find((p) => p.type === "month")?.value;
    d = dateParts.find((p) => p.type === "day")?.value;
    const offParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(now);
    offName = offParts.find((p) => p.type === "timeZoneName")?.value;
  } catch {
    // Bad tz string → fall through to UTC bounds below.
  }
  if (!y || !m || !d) {
    const fallback = new Date(now);
    fallback.setUTCHours(0, 0, 0, 0);
    return {
      start: fallback,
      end: new Date(fallback.getTime() + 24 * 60 * 60 * 1000),
    };
  }
  let offMin = 0;
  const oh = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(offName ?? "");
  if (oh) {
    const sign = oh[1] === "-" ? -1 : 1;
    offMin = sign * (parseInt(oh[2]!, 10) * 60 + parseInt(oh[3] ?? "0", 10));
  }
  const localMidnightUtc =
    Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10)) -
    offMin * 60 * 1000;
  return {
    start: new Date(localMidnightUtc),
    end: new Date(localMidnightUtc + 24 * 60 * 60 * 1000),
  };
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);

    const now = new Date();
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { timezone: true },
    });
    const tz = clinic?.timezone || "Asia/Tashkent";
    const { start: dayStart, end: dayEnd } = clinicTodayBounds(now, tz);

    // 1) Today's appointments — only forward-looking statuses.
    const appts = await prisma.appointment.findMany({
      where: {
        date: { gte: dayStart, lt: dayEnd },
        status: { in: ["BOOKED", "WAITING", "IN_PROGRESS"] },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        status: true,
        priceFinal: true,
        patient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            lastContactedAt: true,
          },
        },
        doctor: { select: { nameRu: true, nameUz: true } },
        primaryService: { select: { nameRu: true, nameUz: true } },
      },
    });
    if (appts.length === 0) {
      const empty: RiskTodayResponse = {
        appointments: [],
        totals: { total: 0, open: 0, handledToday: 0, estimatedLossTiins: 0 },
        windowStart: dayStart.toISOString(),
        windowEnd: dayEnd.toISOString(),
      };
      return ok(empty);
    }

    const apptIds = appts.map((a) => a.id);

    // 2) All NO_SHOW_RISK_HIGH + UNCONFIRMED_24H actions touching today's
    // appointments — both still-OPEN (drives reasons[]) and DONE-today
    // (drives the handledToday counter). One query keeps the round-trip flat.
    const startOfTodayUtc = new Date(now);
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
    const actions = await prisma.action.findMany({
      where: {
        type: { in: ["NO_SHOW_RISK_HIGH", "UNCONFIRMED_24H"] },
        OR: [
          { status: { in: ["OPEN", "SNOOZED"] } },
          { status: "DONE", doneAt: { gte: startOfTodayUtc } },
        ],
      },
      select: {
        id: true,
        type: true,
        status: true,
        payload: true,
        doneAt: true,
        snoozeUntil: true,
      },
    });

    type ActionLite = {
      id: string;
      type: "NO_SHOW_RISK_HIGH" | "UNCONFIRMED_24H";
      status: string;
      payload: ActionPayload;
      doneAt: Date | null;
      snoozeUntil: Date | null;
    };
    // Cast once — payload is JSONB. We only read appointmentId + risk.
    const lite = actions as unknown as ActionLite[];

    const openByAppt = new Map<string, ActionLite[]>();
    const doneTodayApptIds = new Set<string>();
    for (const a of lite) {
      const apptId = (a.payload as { appointmentId?: string }).appointmentId;
      if (!apptId) continue;
      if (a.status === "DONE") {
        if (apptIds.includes(apptId)) doneTodayApptIds.add(apptId);
        continue;
      }
      // Treat SNOOZED with an elapsed timer as OPEN (matches /actions list).
      if (a.status === "SNOOZED" && a.snoozeUntil && a.snoozeUntil > now) {
        continue;
      }
      const arr = openByAppt.get(apptId) ?? [];
      arr.push(a);
      openByAppt.set(apptId, arr);
    }

    const noContactCutoff = new Date(
      now.getTime() - NO_CONTACT_DAYS * 24 * 60 * 60 * 1000,
    );

    const rows: RiskTodayRow[] = [];
    let estimatedLossTiins = 0;

    for (const ap of appts) {
      const reasons: RiskReason[] = [];
      const actionIds: string[] = [];
      let riskScore = 0;

      const open = openByAppt.get(ap.id) ?? [];
      for (const act of open) {
        actionIds.push(act.id);
        if (act.type === "NO_SHOW_RISK_HIGH") {
          const p = act.payload as NoShowRiskHighPayload;
          reasons.push({ kind: "high_risk", risk: p.risk });
          if (p.risk > riskScore) riskScore = p.risk;
        } else if (act.type === "UNCONFIRMED_24H") {
          // Use the appointment's own start to avoid drift between detector
          // timestamp and current clock.
          const _p = act.payload as Unconfirmed24hPayload;
          void _p;
          const hoursToAppt =
            (ap.date.getTime() - now.getTime()) / (60 * 60 * 1000);
          reasons.push({
            kind: "unconfirmed_24h",
            hoursToAppt: Math.round(hoursToAppt * 10) / 10,
          });
          if (UNCONFIRMED_RISK_BASE > riskScore)
            riskScore = UNCONFIRMED_RISK_BASE;
        }
      }

      // No-contact reason: lastContactedAt is null OR older than threshold.
      // We do not push this for brand-new patients with no visits yet — they
      // are by definition "never contacted" through the bump path; the
      // unconfirmed_24h reason already covers them when relevant.
      const lc = ap.patient.lastContactedAt;
      const everContacted = lc !== null;
      if (everContacted && lc! < noContactCutoff) {
        const days = Math.floor(
          (now.getTime() - lc!.getTime()) / (24 * 60 * 60 * 1000),
        );
        reasons.push({ kind: "no_contact", daysSinceContact: days });
        // Slope: 14d → floor, 180d+ → ceiling.
        const t = Math.min(1, Math.max(0, (days - NO_CONTACT_DAYS) / 166));
        const score =
          NO_CONTACT_RISK_FLOOR +
          (NO_CONTACT_RISK_CEILING - NO_CONTACT_RISK_FLOOR) * t;
        if (score > riskScore) riskScore = score;
      }

      if (reasons.length === 0) continue;

      const priceTiins = ap.priceFinal ?? FALLBACK_PRICE_TIINS;
      // Expected loss = price × highest reason risk.
      estimatedLossTiins += Math.round(priceTiins * riskScore);

      rows.push({
        appointmentId: ap.id,
        patientId: ap.patient.id,
        patientName: ap.patient.fullName,
        patientPhone: ap.patient.phone || null,
        appointmentAt: ap.date.toISOString(),
        doctorName: { ru: ap.doctor.nameRu, uz: ap.doctor.nameUz },
        serviceName: ap.primaryService
          ? { ru: ap.primaryService.nameRu, uz: ap.primaryService.nameUz }
          : null,
        priceFinalTiins: ap.priceFinal ?? null,
        status: ap.status as "BOOKED" | "WAITING" | "IN_PROGRESS",
        reasons,
        riskScore: Math.round(riskScore * 100) / 100,
        actionIds,
      });
    }

    const response: RiskTodayResponse = {
      appointments: rows,
      totals: {
        total: rows.length + doneTodayApptIds.size,
        open: rows.length,
        handledToday: doneTodayApptIds.size,
        estimatedLossTiins,
      },
      windowStart: dayStart.toISOString(),
      windowEnd: dayEnd.toISOString(),
    };
    return ok(response);
  },
);

export const POST = () => err("Method Not Allowed", 405);
export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
