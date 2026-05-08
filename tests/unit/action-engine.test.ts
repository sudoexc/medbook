/**
 * Integration test for the Action Center engine (Phase 13 Wave 2).
 *
 * Mocks each detector module + the repository helpers + realtime publish,
 * and verifies:
 *   - All 10 detectors are invoked when `runActionEngine` runs.
 *   - A single failing detector does not abort the others.
 *   - Two consecutive runs against the same data yield `skipped > 0` on
 *     the second run (no churn).
 *   - `publishEvent` fires once per upsert with the right type.
 *   - `expireStaleActions` is invoked at the end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ActionPayload, ActionType } from "@/lib/actions/types";

// ─────────────────────────────────────────────────────────────────────────
// Mock setup. We mock detector modules + the repository + the publisher.
// ─────────────────────────────────────────────────────────────────────────

const detectorMocks = {
  empty: vi.fn(),
  dormant: vi.fn(),
  unconfirmed: vi.fn(),
  noShow: vi.fn(),
  caseRepeat: vi.fn(),
  followUp: vi.fn(),
  overload: vi.fn(),
  idle: vi.fn(),
  payment: vi.fn(),
  lowSched: vi.fn(),
};

const upsertMock = vi.fn();
const expireMock = vi.fn();
const publishMock = vi.fn();

vi.mock("@/server/actions/detectors/empty-slot-tomorrow", () => ({
  detectEmptySlotTomorrow: (...args: unknown[]) => detectorMocks.empty(...args),
  severityForEmptySlot: () => "high" as const,
}));
vi.mock("@/server/actions/detectors/dormant-batch", () => ({
  detectDormantBatch: (...args: unknown[]) => detectorMocks.dormant(...args),
}));
vi.mock("@/server/actions/detectors/unconfirmed-24h", () => ({
  detectUnconfirmed24h: (...args: unknown[]) => detectorMocks.unconfirmed(...args),
  severityForUnconfirmed24h: () => "medium" as const,
}));
vi.mock("@/server/actions/detectors/no-show-risk-high", () => ({
  detectNoShowRiskHigh: (...args: unknown[]) => detectorMocks.noShow(...args),
  severityForNoShowRisk: () => "high" as const,
}));
vi.mock("@/server/actions/detectors/case-repeat-due", () => ({
  detectCaseRepeatDue: (...args: unknown[]) => detectorMocks.caseRepeat(...args),
}));
vi.mock("@/server/actions/detectors/overdue-follow-up", () => ({
  detectOverdueFollowUp: (...args: unknown[]) => detectorMocks.followUp(...args),
}));
vi.mock("@/server/actions/detectors/doctor-overload", () => ({
  detectDoctorOverload: (...args: unknown[]) => detectorMocks.overload(...args),
}));
vi.mock("@/server/actions/detectors/idle-room", () => ({
  detectIdleRoom: (...args: unknown[]) => detectorMocks.idle(...args),
}));
vi.mock("@/server/actions/detectors/payment-overdue", () => ({
  detectPaymentOverdue: (...args: unknown[]) => detectorMocks.payment(...args),
  severityForPaymentOverdue: () => "high" as const,
}));
vi.mock("@/server/actions/detectors/low-doctor-schedule", () => ({
  detectLowDoctorSchedule: (...args: unknown[]) => detectorMocks.lowSched(...args),
}));

vi.mock("@/server/actions/repository", () => ({
  upsertAction: (...args: unknown[]) => upsertMock(...args),
  expireStaleActions: (...args: unknown[]) => expireMock(...args),
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEvent: (...args: unknown[]) => publishMock(...args),
}));

// Import AFTER mocks so the engine binds to mock fns.
const { runActionEngine } = await import("@/server/actions/engine");

const fakePrisma = {} as never;
const clinicId = "clinic-1";
const now = new Date("2026-05-06T08:00:00.000Z");

function emptyAll() {
  for (const fn of Object.values(detectorMocks)) {
    fn.mockResolvedValue([]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  emptyAll();
  upsertMock.mockResolvedValue({
    id: "noop",
    created: false,
    severity: "medium",
    payloadChanged: false,
    severityChanged: false,
  });
  expireMock.mockResolvedValue(0);
  publishMock.mockResolvedValue(undefined);
});

describe("runActionEngine", () => {
  it("invokes all 10 detectors", async () => {
    await runActionEngine(fakePrisma, clinicId, now);
    for (const [name, fn] of Object.entries(detectorMocks)) {
      expect(fn, `detector ${name} should be invoked`).toHaveBeenCalledTimes(1);
    }
  });

  it("isolates a failing detector from the rest", async () => {
    detectorMocks.empty.mockRejectedValueOnce(new Error("boom"));
    const res = await runActionEngine(fakePrisma, clinicId, now);
    // Other 9 detectors still ran.
    expect(detectorMocks.dormant).toHaveBeenCalledTimes(1);
    expect(detectorMocks.lowSched).toHaveBeenCalledTimes(1);
    // The failure surfaces in errors.
    expect(res.errors.some((e) => e.type === "EMPTY_SLOT_TOMORROW")).toBe(true);
  });

  it("publishes action.created on insert and increments created counter", async () => {
    const payload: ActionPayload = {
      type: "DORMANT_BATCH",
      segment: "90-180",
      patientCount: 25,
      lastCampaignAt: null,
    };
    detectorMocks.dormant.mockResolvedValueOnce([payload]);
    upsertMock.mockResolvedValueOnce({
      id: "act-1",
      created: true,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    const res = await runActionEngine(fakePrisma, clinicId, now);
    expect(res.created).toBe(1);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(clinicId, {
      type: "action.created",
      payload: { id: "act-1", type: "DORMANT_BATCH", severity: "medium" },
    });
  });

  it("publishes action.updated when payload/severity changes", async () => {
    const payload: ActionPayload = {
      type: "DORMANT_BATCH",
      segment: "90-180",
      patientCount: 25,
      lastCampaignAt: null,
    };
    detectorMocks.dormant.mockResolvedValueOnce([payload]);
    upsertMock.mockResolvedValueOnce({
      id: "act-1",
      created: false,
      severity: "high",
      payloadChanged: true,
      severityChanged: true,
    });
    const res = await runActionEngine(fakePrisma, clinicId, now);
    expect(res.updated).toBe(1);
    expect(publishMock).toHaveBeenCalledWith(clinicId, {
      type: "action.updated",
      payload: { id: "act-1", type: "DORMANT_BATCH", severity: "high" },
    });
  });

  it("does NOT publish when upsert is a no-op (skipped)", async () => {
    const payload: ActionPayload = {
      type: "DORMANT_BATCH",
      segment: "90-180",
      patientCount: 25,
      lastCampaignAt: null,
    };
    detectorMocks.dormant.mockResolvedValueOnce([payload]);
    upsertMock.mockResolvedValueOnce({
      id: "act-1",
      created: false,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    const res = await runActionEngine(fakePrisma, clinicId, now);
    expect(res.skipped).toBe(1);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("two consecutive runs with same data yield skipped>0 on the second", async () => {
    const payload: ActionPayload = {
      type: "DORMANT_BATCH",
      segment: "90-180",
      patientCount: 25,
      lastCampaignAt: null,
    };
    detectorMocks.dormant.mockResolvedValue([payload]);

    // First run: insert.
    upsertMock.mockResolvedValueOnce({
      id: "act-1",
      created: true,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    const r1 = await runActionEngine(fakePrisma, clinicId, now);
    expect(r1.created).toBe(1);

    // Second run: identical payload → no-op upsert.
    upsertMock.mockResolvedValueOnce({
      id: "act-1",
      created: false,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    const r2 = await runActionEngine(fakePrisma, clinicId, now);
    expect(r2.skipped).toBe(1);
    expect(r2.created).toBe(0);
  });

  it("invokes expireStaleActions at the end and reports its count", async () => {
    expireMock.mockResolvedValueOnce(3);
    const res = await runActionEngine(fakePrisma, clinicId, now);
    expect(expireMock).toHaveBeenCalledTimes(1);
    expect(expireMock).toHaveBeenCalledWith(fakePrisma, clinicId, 48);
    expect(res.expired).toBe(3);
  });

  it("sets explicit expiresAt for NO_SHOW_RISK_HIGH (= appointmentAt)", async () => {
    const apptAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const payload: ActionPayload = {
      type: "NO_SHOW_RISK_HIGH",
      appointmentId: "a1",
      patientId: "p1",
      patientName: "x",
      risk: 0.85,
      appointmentAt: apptAt.toISOString(),
    };
    detectorMocks.noShow.mockResolvedValueOnce([payload]);
    upsertMock.mockResolvedValueOnce({
      id: "act-1",
      created: true,
      severity: "high",
      payloadChanged: false,
      severityChanged: false,
    });
    await runActionEngine(fakePrisma, clinicId, now);
    const opts = upsertMock.mock.calls[0]?.[3] as {
      expiresAt?: Date | null;
    };
    expect(opts.expiresAt).toBeInstanceOf(Date);
    expect(opts.expiresAt?.toISOString()).toBe(apptAt.toISOString());
  });

  it("sets +30min expiresAt for DOCTOR_OVERLOAD and IDLE_ROOM", async () => {
    const overloadPayload: ActionPayload = {
      type: "DOCTOR_OVERLOAD",
      doctorId: "d1",
      doctorName: "x",
      queueLength: 10,
      alternativeDoctorIds: [],
    };
    const idlePayload: ActionPayload = {
      type: "IDLE_ROOM",
      cabinetId: "cab1",
      cabinetName: "x",
      idleMinutes: 25,
      queueLength: 3,
    };
    detectorMocks.overload.mockResolvedValueOnce([overloadPayload]);
    detectorMocks.idle.mockResolvedValueOnce([idlePayload]);
    upsertMock.mockResolvedValue({
      id: "act-x",
      created: true,
      severity: "medium",
      payloadChanged: false,
      severityChanged: false,
    });
    await runActionEngine(fakePrisma, clinicId, now);

    // Find both upsert calls and assert their expiresAt is now+30m.
    const target = now.getTime() + 30 * 60 * 1000;
    const calls = upsertMock.mock.calls.filter((args) => {
      const p = args[2] as { type: ActionType };
      return p.type === "DOCTOR_OVERLOAD" || p.type === "IDLE_ROOM";
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const opts = call[3] as { expiresAt?: Date | null };
      expect(opts.expiresAt?.getTime()).toBe(target);
    }
  });

  it("captures upsert errors per-detector without failing the run", async () => {
    const payload: ActionPayload = {
      type: "DORMANT_BATCH",
      segment: "90-180",
      patientCount: 25,
      lastCampaignAt: null,
    };
    detectorMocks.dormant.mockResolvedValueOnce([payload]);
    upsertMock.mockRejectedValueOnce(new Error("db down"));
    const res = await runActionEngine(fakePrisma, clinicId, now);
    expect(res.errors.some((e) => e.error.includes("db down"))).toBe(true);
    // Other detectors still ran.
    expect(detectorMocks.lowSched).toHaveBeenCalledTimes(1);
  });
});
