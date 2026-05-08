/**
 * Tests for the DORMANT_BATCH detector.
 *
 * Mocks Prisma findMany calls for patient / appointment / campaign and verifies:
 *   - empty input → empty array
 *   - single bucket meets threshold → one payload
 *   - cooldown active → suppressed
 *   - dedupe — running twice yields identical payloads
 */
import { describe, it, expect } from "vitest";

import { detectDormantBatch } from "@/server/actions/detectors/dormant-batch";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Patient = { id: string; lastVisitAt: Date | null };
type FutureAppt = { patientId: string };
type Campaign = {
  id: string;
  segment: unknown;
  createdAt: Date;
  scheduledFor: Date | null;
  startedAt: Date | null;
};

function makePrisma(state: {
  patients: Patient[];
  future: FutureAppt[];
  campaigns: Campaign[];
}) {
  return {
    patient: { findMany: async () => state.patients },
    appointment: { findMany: async () => state.future },
    campaign: { findMany: async () => state.campaigns },
  } as never;
}

const now = new Date("2026-05-06T10:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

function daysAgo(d: number): Date {
  return new Date(now.getTime() - d * dayMs);
}

describe("detectDormantBatch", () => {
  it("returns [] when no patients", async () => {
    const out = await detectDormantBatch(
      makePrisma({ patients: [], future: [], campaigns: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("returns [] when bucket count below threshold", async () => {
    // Threshold defaults to 20 — a single dormant patient must NOT fire.
    const out = await detectDormantBatch(
      makePrisma({
        patients: [{ id: "p1", lastVisitAt: daysAgo(120) }],
        future: [],
        campaigns: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits one payload per bucket meeting threshold", async () => {
    const patients: Patient[] = [];
    for (let i = 0; i < DEFAULT_CONFIG.dormantBatchMin; i++) {
      patients.push({ id: `p${i}`, lastVisitAt: daysAgo(120) });
    }
    const out = await detectDormantBatch(
      makePrisma({ patients, future: [], campaigns: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("DORMANT_BATCH");
    expect(out[0]?.segment).toBe("90-180");
    expect(out[0]?.patientCount).toBe(DEFAULT_CONFIG.dormantBatchMin);
    expect(out[0]?.lastCampaignAt).toBeNull();
  });

  it("suppresses bucket when a recent dormant campaign exists", async () => {
    const patients: Patient[] = [];
    for (let i = 0; i < DEFAULT_CONFIG.dormantBatchMin; i++) {
      patients.push({ id: `p${i}`, lastVisitAt: daysAgo(120) });
    }
    const recent = daysAgo(5);
    const out = await detectDormantBatch(
      makePrisma({
        patients,
        future: [],
        campaigns: [
          {
            id: "camp1",
            segment: { kind: "dormant", bucket: "90-180" },
            createdAt: recent,
            scheduledFor: null,
            startedAt: recent,
          },
        ],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("excludes patients with future appointments", async () => {
    const patients: Patient[] = [];
    for (let i = 0; i < DEFAULT_CONFIG.dormantBatchMin; i++) {
      patients.push({ id: `p${i}`, lastVisitAt: daysAgo(120) });
    }
    // All but one have future appts → bucket count drops below threshold.
    const future: FutureAppt[] = patients
      .slice(1)
      .map((p) => ({ patientId: p.id }));
    const out = await detectDormantBatch(
      makePrisma({ patients, future, campaigns: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("dedupe — running twice yields identical payloads", async () => {
    const patients: Patient[] = [];
    for (let i = 0; i < DEFAULT_CONFIG.dormantBatchMin; i++) {
      patients.push({ id: `p${i}`, lastVisitAt: daysAgo(200) });
    }
    const state = { patients, future: [], campaigns: [] };
    const a = await detectDormantBatch(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    const b = await detectDormantBatch(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
    expect(a[0]?.segment).toBe("180-365");
  });
});
