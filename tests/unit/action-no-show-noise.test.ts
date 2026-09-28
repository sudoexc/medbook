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
 */
import { describe, expect, it, vi } from "vitest";

import { computeNoShowRisk } from "@/lib/ai/no-show-risk";
import {
  IN_CLINIC_APPOINTMENT_STATUSES,
  RISK_TODAY_APPOINTMENT_STATUSES,
} from "@/lib/actions/types";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { detectNoShowRiskHigh } from "@/server/actions/detectors/no-show-risk-high";
import { retireInClinicRiskActions } from "@/server/actions/in-clinic";

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

describe("retireInClinicRiskActions", () => {
  function store() {
    const actions = [
      // Raised while the patient was BOOKED; they have since checked in.
      { id: "risk_arrived", type: "NO_SHOW_RISK_HIGH", severity: "medium", status: "OPEN", outcome: null, payload: { type: "NO_SHOW_RISK_HIGH", appointmentId: "ap_waiting" } },
      { id: "unconf_in_room", type: "UNCONFIRMED_24H", severity: "high", status: "SNOOZED", outcome: null, payload: { type: "UNCONFIRMED_24H", appointmentId: "ap_in_progress" } },
      // Still expected: stays.
      { id: "risk_booked", type: "NO_SHOW_RISK_HIGH", severity: "medium", status: "OPEN", outcome: null, payload: { type: "NO_SHOW_RISK_HIGH", appointmentId: "ap_booked" } },
    ];
    const appts = [
      { id: "ap_waiting", status: "WAITING" },
      { id: "ap_in_progress", status: "IN_PROGRESS" },
      { id: "ap_booked", status: "BOOKED" },
    ];
    const updateMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      for (const a of actions) if (where.id.in.includes(a.id)) a.status = "EXPIRED";
      return { count: where.id.in.length };
    });
    const actionFindMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      expect(where.outcome).toBeNull();
      return actions.filter((a) => ["OPEN", "SNOOZED"].includes(a.status));
    });
    const prisma = {
      action: { findMany: actionFindMany, updateMany },
      appointment: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; status: { in: string[] } } }) =>
          appts.filter((a) => where.id.in.includes(a.id) && where.status.in.includes(a.status)),
        ),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    return { actions, prisma: prisma as never, raw: prisma };
  }

  it("expires the risk rows of arrived patients and keeps the rest", async () => {
    const s = store();
    expect(await retireInClinicRiskActions(s.prisma, "c1")).toBe(2);
    expect(Object.fromEntries(s.actions.map((a) => [a.id, a.status]))).toEqual({
      risk_arrived: "EXPIRED",
      unconf_in_room: "EXPIRED",
      risk_booked: "OPEN",
    });
    expect(s.raw.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no one has arrived", async () => {
    const s = store();
    s.actions.splice(0, 2);
    expect(await retireInClinicRiskActions(s.prisma, "c1")).toBe(0);
    expect(s.raw.action.updateMany).not.toHaveBeenCalled();
  });
});
