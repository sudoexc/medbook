/**
 * Audit AC-07 — «Высокий риск неявки 60%» for every new patient, and for the
 * patient already sitting in the hall.
 *
 *   - `computeNoShowRisk` gives a patient with no history the Laplace prior
 *     0.5 plus the first-visit bump 0.1 = 0.6, exactly the detector threshold,
 *     so every first-time booking was a «high risk» card;
 *   - the detector scanned WAITING visits, and the risk-today list showed
 *     WAITING / IN_PROGRESS ones, so a patient who had checked in (and every
 *     returning walk-in, registered straight into WAITING) was offered to
 *     reception as a call.
 *
 * Acceptance: a first-time patient with no other factor gets no
 * NO_SHOW_RISK_HIGH; a WAITING / IN_PROGRESS visit is not in the risk list.
 * The risk-today list side is driven end to end in risk-today-outcome.test.ts.
 *
 * Review: the engine's retire pass skipped rows a call outcome had snoozed
 * («Не дозвонился», «Перезвонить позже»), so they came back on their timer
 * while the patient sat in the hall, and it only saw WAITING / IN_PROGRESS,
 * so a visit that finished between two passes kept its row for two days.
 */
import { describe, expect, it, vi } from "vitest";

import { computeNoShowRisk } from "@/lib/ai/no-show-risk";
import {
  IN_CLINIC_APPOINTMENT_STATUSES,
  RISK_TODAY_APPOINTMENT_STATUSES,
} from "@/lib/actions/types";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { detectNoShowRiskHigh } from "@/server/actions/detectors/no-show-risk-high";
import { retireMootRiskActions } from "@/server/actions/in-clinic";

const NOW = new Date("2026-09-28T05:00:00.000Z"); // 10:00 Tashkent
const HOUR = 60 * 60 * 1000;

type Upcoming = {
  id: string;
  date: Date;
  patientId: string;
  status: string;
  createdAt: Date;
  patient: { id: string; fullName: string };
};

/** Evaluates the appointment `where` the detector sends, like Postgres would. */
function detectorPrisma(state: {
  appts: Upcoming[];
  history: Array<{ patientId: string; status: string }>;
  remindedApptIds?: string[];
}) {
  const seen: Array<Record<string, unknown>> = [];
  const prisma = {
    appointment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(where);
        const status = where.status as string | { in: string[] };
        if (typeof status === "object" && status.in.includes("COMPLETED")) {
          return state.history;
        }
        return state.appts.filter((a) =>
          typeof status === "string" ? a.status === status : status.in.includes(a.status),
        );
      },
    },
    notificationSend: {
      findMany: async () =>
        (state.remindedApptIds ?? []).map((appointmentId) => ({
          appointmentId,
          status: "SENT",
          readAt: null,
        })),
    },
  };
  return { prisma: prisma as never, seen };
}

function appt(id: string, patientId: string, status = "BOOKED"): Upcoming {
  return {
    id,
    date: new Date(NOW.getTime() + 2 * HOUR),
    patientId,
    status,
    createdAt: new Date(NOW.getTime() - HOUR),
    patient: { id: patientId, fullName: `Пациент ${patientId}` },
  };
}

describe("NO_SHOW_RISK_HIGH for a patient with no history", () => {
  it("the prior alone sits exactly on the old threshold", () => {
    const { risk } = computeNoShowRisk({
      totalVisits: 0,
      noShows: 0,
      hasUnconfirmedReminder: false,
      hoursToAppointment: 2,
      isFirstVisit: true,
    });
    expect(risk).toBeGreaterThanOrEqual(DEFAULT_CONFIG.noShowRiskThreshold);
  });

  it("a first-time patient without other factors gets no task", async () => {
    const { prisma } = detectorPrisma({ appts: [appt("a1", "new")], history: [] });
    expect(await detectNoShowRiskHigh(prisma, "c1", NOW, DEFAULT_CONFIG)).toEqual([]);
  });

  it("nor with an unread reminder: an unconfirmed new booking is UNCONFIRMED_24H's job", async () => {
    const { prisma } = detectorPrisma({
      appts: [appt("a1", "new")],
      history: [],
      remindedApptIds: ["a1"],
    });
    expect(await detectNoShowRiskHigh(prisma, "c1", NOW, DEFAULT_CONFIG)).toEqual([]);
  });

  it("a patient who actually missed visits is still flagged", async () => {
    const { prisma } = detectorPrisma({
      appts: [appt("a1", "p_new"), appt("a2", "p_missed")],
      history: [
        { patientId: "p_missed", status: "NO_SHOW" },
        { patientId: "p_missed", status: "COMPLETED" },
        { patientId: "p_missed", status: "NO_SHOW" },
      ],
    });
    const out = await detectNoShowRiskHigh(prisma, "c1", NOW, DEFAULT_CONFIG);
    expect(out.map((p) => p.appointmentId)).toEqual(["a2"]);
    expect(out[0]!.risk).toBeGreaterThanOrEqual(DEFAULT_CONFIG.noShowRiskThreshold);
  });

  it("a regular who always comes stays below the threshold", async () => {
    const { prisma } = detectorPrisma({
      appts: [appt("a1", "p_reg")],
      history: [{ patientId: "p_reg", status: "COMPLETED" }],
      remindedApptIds: ["a1"],
    });
    expect(await detectNoShowRiskHigh(prisma, "c1", NOW, DEFAULT_CONFIG)).toEqual([]);
  });
});

describe("a patient in the clinic is not a no-show risk", () => {
  it("the detector scans BOOKED visits only, never WAITING / IN_PROGRESS", async () => {
    const history = [
      { patientId: "p_1", status: "NO_SHOW" },
      { patientId: "p_2", status: "NO_SHOW" },
      { patientId: "p_3", status: "NO_SHOW" },
    ];
    const { prisma, seen } = detectorPrisma({
      appts: [appt("a1", "p_1", "WAITING"), appt("a2", "p_2", "IN_PROGRESS"), appt("a3", "p_3")],
      history,
    });
    const out = await detectNoShowRiskHigh(prisma, "c1", NOW, DEFAULT_CONFIG);
    expect(out.map((p) => p.appointmentId)).toEqual(["a3"]);
    expect(seen[0]!.status).toBe("BOOKED");
  });

  it("the risk-today list and its outcome endpoint leave arrived patients out", () => {
    for (const s of IN_CLINIC_APPOINTMENT_STATUSES) {
      expect(RISK_TODAY_APPOINTMENT_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});

describe("retireMootRiskActions", () => {
  type Row = {
    id: string;
    type: string;
    severity: string;
    status: string;
    outcome: string | null;
    doneAt?: Date;
    payload: { type: string; appointmentId: string };
  };
  function row(
    id: string,
    type: string,
    appointmentId: string,
    status = "OPEN",
    outcome: string | null = null,
  ): Row {
    return { id, type, severity: "medium", status, outcome, payload: { type, appointmentId } };
  }

  /** Evaluates the `where` clauses the retire sends, like Postgres would. */
  function store(actions: Row[], appts: Array<{ id: string; status: string }>) {
    const audits: Array<{ action: string; entityId: string; meta: Record<string, unknown> }> = [];
    const updateMany = vi.fn(
      async ({ where, data }: { where: { id: { in: string[] }; status: { in: string[] } }; data: Partial<Row> }) => {
        let count = 0;
        for (const a of actions) {
          if (where.id.in.includes(a.id) && where.status.in.includes(a.status)) {
            Object.assign(a, data);
            count += 1;
          }
        }
        return { count };
      },
    );
    const actionFindMany = vi.fn(
      async ({ where }: { where: { type: { in: string[] }; status: { in: string[] } } }) =>
        actions.filter((a) => where.type.in.includes(a.type) && where.status.in.includes(a.status)),
    );
    const prisma = {
      action: { findMany: actionFindMany, updateMany },
      appointment: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          appts.filter((a) => where.id.in.includes(a.id)),
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: { action: string; entityId: string; meta: Record<string, unknown> } }) => {
          audits.push(data);
          return {};
        }),
      },
    };
    const statusOf = () => Object.fromEntries(actions.map((a) => [a.id, a.status]));
    return { actions, audits, statusOf, prisma: prisma as never, raw: prisma };
  }

  it("expires the risk rows of arrived patients and keeps the rest", async () => {
    const s = store(
      [
        // Raised while the patient was BOOKED; they have since checked in.
        row("risk_arrived", "NO_SHOW_RISK_HIGH", "ap_waiting"),
        row("unconf_in_room", "UNCONFIRMED_24H", "ap_in_progress", "SNOOZED"),
        // Still expected: stays.
        row("risk_booked", "NO_SHOW_RISK_HIGH", "ap_booked"),
        row("unconf_confirmed", "NO_SHOW_RISK_HIGH", "ap_confirmed"),
      ],
      [
        { id: "ap_waiting", status: "WAITING" },
        { id: "ap_in_progress", status: "IN_PROGRESS" },
        { id: "ap_booked", status: "BOOKED" },
        { id: "ap_confirmed", status: "CONFIRMED" },
      ],
    );
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(2);
    expect(s.statusOf()).toEqual({
      risk_arrived: "EXPIRED",
      unconf_in_room: "EXPIRED",
      risk_booked: "OPEN",
      unconf_confirmed: "OPEN",
    });
    expect(s.audits.map((a) => a.action)).toEqual(["ACTION_EXPIRED", "ACTION_EXPIRED"]);
  });

  it("does nothing while every visit is still ahead", async () => {
    const s = store(
      [row("risk_booked", "NO_SHOW_RISK_HIGH", "ap_booked")],
      [{ id: "ap_booked", status: "BOOKED" }],
    );
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(0);
    expect(s.raw.action.updateMany).not.toHaveBeenCalled();
  });

  // Review of AC-07: «Не дозвонился» at 11:30 snoozed both rows to 13:30; he
  // walked in at 12:30. The rows came back at 13:30 in the Action Center, the
  // KPIs, the briefing and «К подтверждению» while he sat in the hall, and
  // UNCONFIRMED_24H stayed for two days after the visit.
  it("closes a row a call outcome snoozed as DONE, keeping the outcome for «Обработано сегодня»", async () => {
    const s = store(
      [
        row("risk_no_answer", "NO_SHOW_RISK_HIGH", "ap_ivanov", "SNOOZED", "NO_ANSWER"),
        row("unconf_no_answer", "UNCONFIRMED_24H", "ap_ivanov", "SNOOZED", "NO_ANSWER"),
        // «Перезвонить в 14:00», set before the visit, for another walk-in.
        row("unconf_callback", "UNCONFIRMED_24H", "ap_early", "SNOOZED", "CALLBACK"),
      ],
      [
        { id: "ap_ivanov", status: "WAITING" },
        { id: "ap_early", status: "IN_PROGRESS" },
      ],
    );
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(3);
    for (const a of s.actions) {
      expect(a.status).toBe("DONE");
      expect(a.doneAt).toBeInstanceOf(Date);
    }
    expect(s.actions.map((a) => a.outcome)).toEqual(["NO_ANSWER", "NO_ANSWER", "CALLBACK"]);
    expect(s.audits[0]).toMatchObject({
      action: "ACTION_DONE",
      meta: { newStatus: "DONE", outcome: "NO_ANSWER", reason: "visit_waiting" },
    });
  });

  it("an OPEN row's outcome is a leftover of an earlier occurrence: it expires", async () => {
    const s = store(
      [row("stale", "UNCONFIRMED_24H", "ap_done", "OPEN", "RESCHEDULED")],
      [{ id: "ap_done", status: "COMPLETED" }],
    );
    await retireMootRiskActions(s.prisma, "c1");
    expect(s.statusOf()).toEqual({ stale: "EXPIRED" });
  });

  it("retires the rows of a visit that finished, was cancelled or missed between two passes", async () => {
    const s = store(
      [
        row("unconf_completed", "UNCONFIRMED_24H", "ap_completed"),
        row("unconf_cancelled", "UNCONFIRMED_24H", "ap_cancelled"),
        row("risk_no_show", "NO_SHOW_RISK_HIGH", "ap_no_show", "SNOOZED", "NO_ANSWER"),
        row("call_skipped", "NO_CONTACT_CALL", "ap_skipped", "SNOOZED", "NO_ANSWER"),
      ],
      [
        { id: "ap_completed", status: "COMPLETED" },
        { id: "ap_cancelled", status: "CANCELLED" },
        { id: "ap_no_show", status: "NO_SHOW" },
        { id: "ap_skipped", status: "SKIPPED" },
      ],
    );
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(4);
    expect(s.statusOf()).toEqual({
      unconf_completed: "EXPIRED",
      unconf_cancelled: "EXPIRED",
      risk_no_show: "DONE",
      call_skipped: "DONE",
    });
    expect(s.audits.map((a) => a.meta.reason)).toEqual([
      "visit_completed",
      "visit_cancelled",
      "visit_no_show",
      "visit_skipped",
    ]);
  });

  it("keeps a callback promised before a visit the patient never came to", async () => {
    const s = store(
      [
        row("callback_cancelled", "UNCONFIRMED_24H", "ap_cancelled", "SNOOZED", "CALLBACK"),
        row("callback_no_show", "NO_CONTACT_CALL", "ap_no_show", "SNOOZED", "CALLBACK"),
      ],
      [
        { id: "ap_cancelled", status: "CANCELLED" },
        { id: "ap_no_show", status: "NO_SHOW" },
      ],
    );
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(0);
    expect(s.statusOf()).toEqual({
      callback_cancelled: "SNOOZED",
      callback_no_show: "SNOOZED",
    });
  });

  it("leaves rows alone when their visit is not found", async () => {
    const s = store([row("risk_orphan", "NO_SHOW_RISK_HIGH", "ap_gone")], []);
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(0);
    expect(s.statusOf()).toEqual({ risk_orphan: "OPEN" });
  });

  it("never touches a PATIENT_CALLBACK, which outlives its visit by design (AC-09)", async () => {
    const s = store(
      [row("promise", "PATIENT_CALLBACK", "ap_cancelled", "SNOOZED", null)],
      [{ id: "ap_cancelled", status: "CANCELLED" }],
    );
    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(0);
    expect(s.statusOf()).toEqual({ promise: "SNOOZED" });
  });
});
