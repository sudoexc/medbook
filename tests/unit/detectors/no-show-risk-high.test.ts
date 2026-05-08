/**
 * Tests for the NO_SHOW_RISK_HIGH detector.
 *
 * Mocks appointment.findMany (twice — upcoming + history) and
 * notificationSend.findMany. Verifies:
 *   - empty input → empty array
 *   - no-show-heavy history triggers a payload above threshold
 *   - severity escalates above 0.8
 *   - dedupe — repeated runs yield identical payloads (rounded risk)
 */
import { describe, it, expect } from "vitest";

import {
  detectNoShowRiskHigh,
  severityForNoShowRisk,
} from "@/server/actions/detectors/no-show-risk-high";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Upcoming = {
  id: string;
  date: Date;
  patientId: string;
  status: string;
  createdAt: Date;
  patient: { id: string; fullName: string };
};
type History = { patientId: string; status: string };
type Reminder = {
  appointmentId: string | null;
  status: string;
  readAt: Date | null;
};

function makePrisma(state: {
  upcoming: Upcoming[];
  history: History[];
  reminders: Reminder[];
}) {
  return {
    appointment: {
      findMany: async ({ where }: { where: { status?: unknown } }) => {
        const status = where?.status as
          | { in?: string[] }
          | undefined;
        // Upcoming uses status: { in: ["BOOKED", "WAITING"] }
        // History uses status: { in: ["COMPLETED", "NO_SHOW"] }
        if (status && Array.isArray(status.in) && status.in.includes("COMPLETED")) {
          return state.history;
        }
        return state.upcoming;
      },
    },
    notificationSend: {
      findMany: async () => state.reminders,
    },
  } as never;
}

const now = new Date("2026-05-06T08:00:00.000Z");

function appt(hoursAhead: number, patientId = "p1", id = "a1"): Upcoming {
  return {
    id,
    date: new Date(now.getTime() + hoursAhead * 60 * 60 * 1000),
    patientId,
    status: "BOOKED",
    createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    patient: { id: patientId, fullName: "Иван Петров" },
  };
}

describe("detectNoShowRiskHigh", () => {
  it("returns [] when there are no upcoming appts", async () => {
    const out = await detectNoShowRiskHigh(
      makePrisma({ upcoming: [], history: [], reminders: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload for high-risk patient (heavy no-show history)", async () => {
    const history: History[] = [];
    for (let i = 0; i < 5; i++) history.push({ patientId: "p1", status: "NO_SHOW" });
    history.push({ patientId: "p1", status: "COMPLETED" });
    const out = await detectNoShowRiskHigh(
      makePrisma({
        upcoming: [appt(2)],
        history,
        reminders: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]?.type).toBe("NO_SHOW_RISK_HIGH");
    expect(out[0]?.appointmentId).toBe("a1");
    // risk is rounded to 2 decimals.
    expect(out[0]?.risk).toBe(Math.round(out[0]!.risk * 100) / 100);
    expect(out[0]?.risk).toBeGreaterThanOrEqual(DEFAULT_CONFIG.noShowRiskThreshold);
  });

  it("severity escalates at 0.8 risk", () => {
    const make = (risk: number) => ({
      type: "NO_SHOW_RISK_HIGH" as const,
      appointmentId: "a1",
      patientId: "p1",
      patientName: "x",
      risk,
      appointmentAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    });
    expect(severityForNoShowRisk(make(0.85))).toBe("high");
    expect(severityForNoShowRisk(make(0.7))).toBe("medium");
  });

  it("dedupe — repeated runs yield identical payloads", async () => {
    const history: History[] = [];
    for (let i = 0; i < 5; i++) history.push({ patientId: "p1", status: "NO_SHOW" });
    history.push({ patientId: "p1", status: "COMPLETED" });
    const state = {
      upcoming: [appt(2)],
      history,
      reminders: [],
    };
    const a = await detectNoShowRiskHigh(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    const b = await detectNoShowRiskHigh(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    if (a[0] && b[0]) {
      expect(dedupeKeyFor(a[0])).toBe(dedupeKeyFor(b[0]));
    }
  });
});
