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
};
type Later = {
  id: string;
  date: Date;
  medicalCaseId: string | null;
};
type CaseRow = { id: string };

function makePrisma(state: {
  visits: Visit[];
  later: Later[];
  openCases: CaseRow[];
}) {
  return {
    appointment: {
      findMany: async ({ where }: { where: { status?: unknown } }) => {
        const status = where?.status;
        // visits use status: 'COMPLETED' (string)
        if (status === "COMPLETED") return state.visits;
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
    const visitDate = new Date(now.getTime() - 3 * dayMs);
    const out = await detectOverdueFollowUp(
      makePrisma({
        visits: [
          { id: "a1", date: visitDate, patientId: "p1", medicalCaseId: "case1" },
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
    expect(out[0]?.daysSinceVisit).toBe(3);
  });

  it("suppresses when case is not OPEN", async () => {
    const visitDate = new Date(now.getTime() - 3 * dayMs);
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
    const visitDate = new Date(now.getTime() - 3 * dayMs);
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
    const visitDate = new Date(now.getTime() - 4 * dayMs);
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
});
