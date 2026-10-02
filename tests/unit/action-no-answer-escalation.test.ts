/**
 * Audit AC-28: the third «Не дозвонился» raises the visit's risk row to
 * «Высокий» (`outcomeStamp`), and the next engine pass wrote the detector's
 * severity back over it, so the escalation lived at most 15 minutes.
 * Acceptance: after three NO_ANSWER the severity stays high over several
 * engine ticks.
 */
import { describe, expect, it } from "vitest";

import type { Unconfirmed24hPayload } from "@/lib/actions/types";
import { NO_ANSWER_MAX_ATTEMPTS, outcomeStamp } from "@/server/actions/outcome";
import { severityAfterUpsert, upsertAction } from "@/server/actions/repository";

type Row = Record<string, unknown>;

/** One stored row; `update` merges like Prisma would. */
function store(row: Row) {
  const state = { row: { ...row } };
  const prisma = {
    action: {
      findUnique: async () => state.row,
      update: async ({ data }: { data: Row }) => {
        state.row = { ...state.row, ...data, updatedAt: new Date() };
        return state.row;
      },
      create: async ({ data }: { data: Row }) => ({ id: "act_new", ...data }),
    },
    auditLog: { create: async () => ({}) },
  } as unknown as Parameters<typeof upsertAction>[0];
  return { state, prisma };
}

const payload: Unconfirmed24hPayload = {
  type: "UNCONFIRMED_24H",
  appointmentId: "ap_1",
  patientId: "p_1",
  patientName: "Юсупова Лола",
  appointmentAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
  doctorName: "Султанов А.",
};

function riskRow(over: Row = {}): Row {
  return {
    id: "act_1",
    clinicId: "c1",
    branchId: null,
    type: "UNCONFIRMED_24H",
    severity: "medium",
    status: "OPEN",
    payload,
    assigneeRole: "RECEPTIONIST",
    deeplinkPath: "/crm/appointments/ap_1",
    dedupeKey: "UNCONFIRMED_24H:appointmentId=ap_1",
    snoozeUntil: null,
    dismissedAt: null,
    doneAt: null,
    expiresAt: null,
    outcome: null,
    callAttempts: 0,
    updatedAt: new Date(),
    ...over,
  };
}

const noAnswer = { outcome: "NO_ANSWER" as const, note: null, callbackAt: null };

describe("NO_ANSWER escalation survives the engine (audit AC-28)", () => {
  it("three missed calls make it high, and engine ticks keep it high", async () => {
    const { state, prisma } = store(riskRow());
    for (let i = 0; i < NO_ANSWER_MAX_ATTEMPTS; i++) {
      Object.assign(
        state.row,
        outcomeStamp(
          state.row as { callAttempts: number; severity: string },
          noAnswer,
          "u_recept",
          new Date(),
        ),
      );
    }
    expect(state.row).toMatchObject({ severity: "high", callAttempts: 3, status: "SNOOZED" });

    // Four engine passes, the detector still reading «medium».
    for (let tick = 0; tick < 4; tick++) {
      const res = await upsertAction(prisma, "c1", payload, { severity: "medium" });
      expect(res.severity).toBe("high");
      expect(res.severityChanged).toBe(false);
    }
    expect(state.row.severity).toBe("high");
  });

  it("two missed calls are not an escalation: the detector's reading stands", async () => {
    const { state, prisma } = store(riskRow({ severity: "high", callAttempts: 2 }));
    const res = await upsertAction(prisma, "c1", payload, { severity: "medium" });
    expect(res.severity).toBe("medium");
    expect(state.row.severity).toBe("medium");
  });

  it("a louder detector reading still wins", () => {
    expect(severityAfterUpsert({ severity: "high", callAttempts: 3 }, "critical", false)).toBe(
      "critical",
    );
    expect(severityAfterUpsert({ severity: "high", callAttempts: 4 }, "low", false)).toBe("high");
  });

  it("a reopened row is a new occurrence and starts from the detector", async () => {
    expect(severityAfterUpsert({ severity: "high", callAttempts: 3 }, "medium", true)).toBe(
      "medium",
    );
    const { state, prisma } = store(
      riskRow({ status: "EXPIRED", severity: "high", callAttempts: 3 }),
    );
    const res = await upsertAction(prisma, "c1", payload, { severity: "medium" });
    expect(state.row.status).toBe("OPEN");
    expect(res.severity).toBe("medium");
  });
});
