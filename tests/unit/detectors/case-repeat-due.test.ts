/**
 * Tests for the CASE_REPEAT_DUE detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - within lead window → one payload per case
 *   - case with future booked follow-up → suppressed
 *   - dedupe — repeated runs yield identical payloads
 */
import { describe, it, expect } from "vitest";

import { detectCaseRepeatDue } from "@/server/actions/detectors/case-repeat-due";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type CaseAppt = {
  id: string;
  date: Date;
  status: string;
  primaryService: { freeRepeatDays: number | null } | null;
};
type CaseRow = {
  id: string;
  patientId: string;
  patient: { fullName: string };
  appointments: CaseAppt[];
};

function makePrisma(cases: CaseRow[]) {
  return {
    medicalCase: { findMany: async () => cases },
  } as never;
}

const now = new Date("2026-05-06T08:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

describe("detectCaseRepeatDue", () => {
  it("returns [] when no cases exist", async () => {
    const out = await detectCaseRepeatDue(
      makePrisma([]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits one payload per case whose deadline is within lead window", async () => {
    // first visit was 8 days ago, freeRepeatDays = 14, lead = 7
    // → deadline ~6 days away → within lead window
    const firstVisit = new Date(now.getTime() - 8 * dayMs);
    const out = await detectCaseRepeatDue(
      makePrisma([
        {
          id: "case1",
          patientId: "p1",
          patient: { fullName: "Иван Петров" },
          appointments: [
            {
              id: "a1",
              date: firstVisit,
              status: "COMPLETED",
              primaryService: { freeRepeatDays: 14 },
            },
          ],
        },
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("CASE_REPEAT_DUE");
    expect(out[0]?.caseId).toBe("case1");
    expect(out[0]?.patientName).toBe("Иван Петров");
    expect(out[0]?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("suppresses case with future booked follow-up", async () => {
    const firstVisit = new Date(now.getTime() - 8 * dayMs);
    const out = await detectCaseRepeatDue(
      makePrisma([
        {
          id: "case1",
          patientId: "p1",
          patient: { fullName: "Иван" },
          appointments: [
            {
              id: "a1",
              date: firstVisit,
              status: "COMPLETED",
              primaryService: { freeRepeatDays: 14 },
            },
            {
              id: "a2",
              date: new Date(now.getTime() + 1 * dayMs),
              status: "BOOKED",
              primaryService: { freeRepeatDays: 14 },
            },
          ],
        },
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("suppresses cases too far from deadline", async () => {
    // first visit just yesterday, freeRepeatDays = 30 → deadline ~29 days away
    // exceeds lead window (7 days) → must NOT fire.
    const firstVisit = new Date(now.getTime() - 1 * dayMs);
    const out = await detectCaseRepeatDue(
      makePrisma([
        {
          id: "case1",
          patientId: "p1",
          patient: { fullName: "Иван" },
          appointments: [
            {
              id: "a1",
              date: firstVisit,
              status: "COMPLETED",
              primaryService: { freeRepeatDays: 30 },
            },
          ],
        },
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("dedupe — running twice yields identical payloads", async () => {
    const firstVisit = new Date(now.getTime() - 8 * dayMs);
    const cases: CaseRow[] = [
      {
        id: "case1",
        patientId: "p1",
        patient: { fullName: "Иван" },
        appointments: [
          {
            id: "a1",
            date: firstVisit,
            status: "COMPLETED",
            primaryService: { freeRepeatDays: 14 },
          },
        ],
      },
    ];
    const a = await detectCaseRepeatDue(makePrisma(cases), "c1", now, DEFAULT_CONFIG);
    const b = await detectCaseRepeatDue(makePrisma(cases), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });
});
