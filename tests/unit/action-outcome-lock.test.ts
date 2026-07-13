/**
 * Resurrection guard (TZ-risk-outcomes §3): the 15-min engine recompute must
 * NOT reopen a DONE action once a human recorded a call outcome — until the
 * appointment itself passes (`expiresAt`). Without an outcome, the old
 * DONE→OPEN resurrection still applies. `upsertAction` takes `prisma` as a
 * parameter, so we inject a capturing stub — no module mocks needed.
 */
import { describe, expect, it } from "vitest";

import { upsertAction } from "@/server/actions/repository";
import type { NoShowRiskHighPayload } from "@/lib/actions/types";

type Captured = { updateData: Record<string, unknown> | null };

function stubPrisma(existing: Record<string, unknown>, cap: Captured) {
  return {
    action: {
      findUnique: async () => existing,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        cap.updateData = data;
        return { id: "act_1", ...data };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "act_new",
        ...data,
      }),
    },
    auditLog: { create: async () => ({}) },
  } as unknown as Parameters<typeof upsertAction>[0];
}

const FUTURE = new Date(Date.now() + 3 * 60 * 60_000);
const PAST = new Date(Date.now() - 60_000);

const payload: NoShowRiskHighPayload = {
  type: "NO_SHOW_RISK_HIGH",
  appointmentId: "ap_1",
  patientId: "p_1",
  risk: 0.7,
} as NoShowRiskHighPayload;

function doneRow(over: Record<string, unknown>) {
  return {
    id: "act_1",
    clinicId: "c1",
    branchId: null,
    type: "NO_SHOW_RISK_HIGH",
    severity: "high",
    status: "DONE",
    payload,
    assigneeRole: "RECEPTIONIST",
    deeplinkPath: "/crm/action-center",
    dedupeKey: "NO_SHOW_RISK_HIGH:appointmentId=ap_1",
    snoozeUntil: null,
    dismissedAt: null,
    doneAt: new Date(),
    expiresAt: FUTURE,
    outcome: null,
    outcomeNote: null,
    callbackAt: null,
    resolvedById: null,
    callAttempts: 0,
    ...over,
  };
}

describe("upsertAction — outcome lock", () => {
  it("does NOT resurrect a DONE row that has a recorded outcome (before expiry)", async () => {
    const cap: Captured = { updateData: null };
    const prisma = stubPrisma(doneRow({ outcome: "CONFIRMED" }), cap);
    await upsertAction(prisma, "c1", payload, {
      severity: "high",
      expiresAt: FUTURE,
    });
    expect(cap.updateData?.status).toBe("DONE"); // stayed handled
  });

  it("DOES resurrect a DONE row with no outcome (legacy behaviour)", async () => {
    const cap: Captured = { updateData: null };
    const prisma = stubPrisma(doneRow({ outcome: null }), cap);
    await upsertAction(prisma, "c1", payload, {
      severity: "high",
      expiresAt: FUTURE,
    });
    expect(cap.updateData?.status).toBe("OPEN"); // reopened as before
  });

  it("resurrects an outcome'd row once the appointment has passed (expiresAt)", async () => {
    const cap: Captured = { updateData: null };
    const prisma = stubPrisma(
      doneRow({ outcome: "CONFIRMED", expiresAt: PAST }),
      cap,
    );
    await upsertAction(prisma, "c1", payload, {
      severity: "high",
      expiresAt: PAST,
    });
    expect(cap.updateData?.status).toBe("OPEN");
  });
});
