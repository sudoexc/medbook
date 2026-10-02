/**
 * Tests for the OVERDUE_FOLLOW_UP detector.
 *
 * Mocks appointment.findMany (twice — visits + later) and medicalCase.findMany.
 * Verifies:
 *   - empty input → empty array
 *   - completed visit on OPEN case with no later appt → one payload
 *   - case CLOSED → suppressed
 *   - case has later follow-up → suppressed
 *   - dedupe — repeated runs yield identical payloads
 *   - window: overdue from followUpStaleDays, not before; named (AC-21)
 *   - a control visit planned in the note is VISIT_FOLLOW_UP_DUE's (AC-21)
 */
import { describe, it, expect } from "vitest";

import { detectOverdueFollowUp } from "@/server/actions/detectors/overdue-follow-up";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Visit = {
  id: string;
  date: Date;
  patientId: string;
  medicalCaseId: string | null;
  patient?: { fullName: string } | null;
  visitNote?: { followUpDays: number | null; followUpDate: Date | null } | null;
};
type Later = {
  id: string;
  date: Date;
  medicalCaseId: string | null;
};
type CaseRow = { id: string };

type VisitWhere = { status?: unknown; date?: { gte: Date; lte: Date } };

function makePrisma(state: {
  visits: Visit[];
  later: Later[];
  openCases: CaseRow[];
}) {
  return {
    appointment: {
      findMany: async ({ where }: { where: VisitWhere }) => {
        const status = where?.status;
        // visits use status: 'COMPLETED' (string); honour the date window
        // so the tests pin it.
        if (status === "COMPLETED") {
          const w = where.date!;
          return state.visits.filter(
            (v) => v.date.getTime() >= w.gte.getTime() && v.date.getTime() <= w.lte.getTime(),
          );
        }
        // later appts use status: { notIn: ['CANCELLED', 'NO_SHOW'] }
        return state.later;
      },
    },
    medicalCase: { findMany: async () => state.openCases },
  } as never;
}

const now = new Date("2026-05-06T08:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

describe("detectOverdueFollowUp", () => {
  it("returns [] when no completed visits", async () => {
    const out = await detectOverdueFollowUp(
      makePrisma({ visits: [], later: [], openCases: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload for completed visit on OPEN case with no later appt", async () => {
    const visitDate = new Date(now.getTime() - 10 * dayMs);
    const out = await detectOverdueFollowUp(
      makePrisma({
        visits: [
          {
            id: "a1",
            date: visitDate,
            patientId: "p1",
            medicalCaseId: "case1",
            patient: { fullName: "Каримов Азиз" },
          },
        ],
        later: [
          // The visit itself is in laterByCase but is filtered by `> visitDate`.
          { id: "a1", date: visitDate, medicalCaseId: "case1" },
        ],
        openCases: [{ id: "case1" }],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("OVERDUE_FOLLOW_UP");
    expect(out[0]?.appointmentId).toBe("a1");
    expect(out[0]?.patientId).toBe("p1");
    expect(out[0]?.patientName).toBe("Каримов Азиз");
    expect(out[0]?.daysSinceVisit).toBe(10);
  });

  it("suppresses when case is not OPEN", async () => {
    const visitDate = new Date(now.getTime() - 10 * dayMs);
    const out = await detectOverdueFollowUp(
      makePrisma({
        visits: [
          { id: "a1", date: visitDate, patientId: "p1", medicalCaseId: "case1" },
        ],
        later: [],
        openCases: [], // case1 is CLOSED → openSet empty
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("suppresses when later appointment exists on the case", async () => {
    const visitDate = new Date(now.getTime() - 10 * dayMs);
    const followUpDate = new Date(now.getTime() - 1 * dayMs - 1000);
    const out = await detectOverdueFollowUp(
      makePrisma({
        visits: [
          { id: "a1", date: visitDate, patientId: "p1", medicalCaseId: "case1" },
        ],
        later: [
          { id: "a1", date: visitDate, medicalCaseId: "case1" },
          { id: "a2", date: followUpDate, medicalCaseId: "case1" },
        ],
        openCases: [{ id: "case1" }],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("dedupe — repeated runs yield identical payloads", async () => {
    const visitDate = new Date(now.getTime() - 11 * dayMs);
    const state = {
      visits: [
        { id: "a1", date: visitDate, patientId: "p1", medicalCaseId: "case1" },
      ],
      later: [{ id: "a1", date: visitDate, medicalCaseId: "case1" }],
      openCases: [{ id: "case1" }],
    };
    const a = await detectOverdueFollowUp(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    const b = await detectOverdueFollowUp(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });

  describe("overdue window and the doctor's plan (audit AC-21)", () => {
    const visitAt = (days: number, extra: Partial<Visit> = {}): Visit => ({
      id: `a${days}`,
      date: new Date(now.getTime() - days * dayMs),
      patientId: "p1",
      medicalCaseId: "case1",
      patient: { fullName: "Каримов Азиз" },
      ...extra,
    });
    async function run(visits: Visit[]) {
      return detectOverdueFollowUp(
        makePrisma({ visits, later: [], openCases: [{ id: "case1" }] }),
        "c1",
        now,
        DEFAULT_CONFIG,
      );
    }

    it("a visit 3 days ago is not overdue yet", async () => {
      expect(await run([visitAt(3)])).toEqual([]);
    });

    it("a visit 10 days ago is overdue and stays so past day 7", async () => {
      const out = await run([visitAt(10)]);
      expect(out).toHaveLength(1);
      expect(out[0]?.daysSinceVisit).toBe(10);
      expect(out[0]?.patientName).toBe("Каримов Азиз");
      expect(await run([visitAt(DEFAULT_CONFIG.followUpStaleDays)])).toHaveLength(1);
    });

    it("stops nudging once the visit is older than followUpMaxAgeDays", async () => {
      expect(await run([visitAt(DEFAULT_CONFIG.followUpMaxAgeDays + 1)])).toEqual([]);
    });

    it("skips a visit whose note plans a control visit", async () => {
      const inDays = visitAt(10, {
        visitNote: { followUpDays: 30, followUpDate: null },
      });
      const onDate = visitAt(12, {
        id: "a12",
        visitNote: { followUpDays: null, followUpDate: new Date("2026-06-01") },
      });
      const noPlan = visitAt(14, {
        id: "a14",
        visitNote: { followUpDays: null, followUpDate: null },
      });
      const out = await run([inDays, onDate, noPlan]);
      expect(out.map((p) => p.appointmentId)).toEqual(["a14"]);
    });
  });
});
