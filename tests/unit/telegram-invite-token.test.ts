/**
 * Tests for `consumeInviteToken` (`src/server/telegram/invite-token.ts`).
 *
 * Mocks `@/lib/prisma` and `@/lib/tenant-context` so the helper's decision
 * tree (not-found, expired, already-consumed, wrong-clinic, patient already
 * linked elsewhere, happy path) can be exercised without a real DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type TokenRow = {
  id: string;
  clinicId: string;
  patientId: string;
  expiresAt: Date;
  consumedAt: Date | null;
};
type PatientRow = {
  id: string;
  telegramId: string | null;
};

const state: {
  token: TokenRow | null;
  patient: PatientRow | null;
  patientUpdates: Array<{ id: string; data: unknown }>;
  tokenUpdates: Array<{ id: string; data: unknown }>;
  audits: Array<{ action: string; meta: unknown }>;
} = {
  token: null,
  patient: null,
  patientUpdates: [],
  tokenUpdates: [],
  audits: [],
};

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    telegramInviteToken: {
      findUnique: vi.fn(async () => state.token),
      update: vi.fn(async (args: { where: { id: string }; data: unknown }) => {
        state.tokenUpdates.push({ id: args.where.id, data: args.data });
        return { id: args.where.id };
      }),
    },
    patient: {
      findFirst: vi.fn(async () => state.patient),
      update: vi.fn(async (args: { where: { id: string }; data: unknown }) => {
        state.patientUpdates.push({ id: args.where.id, data: args.data });
        return { id: args.where.id };
      }),
    },
    auditLog: {
      create: vi.fn(async (args: { data: { action: string; meta?: unknown } }) => {
        state.audits.push({ action: args.data.action, meta: args.data.meta });
        return { id: "a1" };
      }),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));

import { consumeInviteToken } from "@/server/telegram/invite-token";

function reset() {
  state.token = null;
  state.patient = null;
  state.patientUpdates = [];
  state.tokenUpdates = [];
  state.audits = [];
}

const NOW = new Date("2026-05-11T12:00:00Z");

describe("consumeInviteToken", () => {
  beforeEach(reset);

  it("returns not-found when the token row is missing", async () => {
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "missing",
      telegramId: "111",
      now: NOW,
    });
    expect(result.kind).toBe("not-found");
  });

  it("returns wrong-clinic when the token belongs to a different clinic", async () => {
    state.token = {
      id: "t1",
      clinicId: "c-other",
      patientId: "p1",
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: null,
    };
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "tok",
      telegramId: "111",
      now: NOW,
    });
    expect(result.kind).toBe("wrong-clinic");
    if (result.kind === "wrong-clinic") {
      expect(result.expectedClinicId).toBe("c-other");
    }
  });

  it("returns already-consumed when consumedAt is set", async () => {
    state.token = {
      id: "t1",
      clinicId: "c1",
      patientId: "p1",
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: new Date(NOW.getTime() - 60_000),
    };
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "tok",
      telegramId: "111",
      now: NOW,
    });
    expect(result.kind).toBe("already-consumed");
  });

  it("returns expired when expiresAt is in the past", async () => {
    state.token = {
      id: "t1",
      clinicId: "c1",
      patientId: "p1",
      expiresAt: new Date(NOW.getTime() - 1_000),
      consumedAt: null,
    };
    state.patient = { id: "p1", telegramId: null };
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "tok",
      telegramId: "111",
      now: NOW,
    });
    expect(result.kind).toBe("expired");
  });

  it("returns patient-already-linked when patient carries a different telegramId", async () => {
    state.token = {
      id: "t1",
      clinicId: "c1",
      patientId: "p1",
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: null,
    };
    state.patient = { id: "p1", telegramId: "222" };
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "tok",
      telegramId: "111",
      now: NOW,
    });
    expect(result.kind).toBe("patient-already-linked");
    expect(state.patientUpdates).toHaveLength(0);
    expect(state.tokenUpdates).toHaveLength(0);
  });

  it("links the patient, stamps the token, and emits an audit on the happy path", async () => {
    state.token = {
      id: "t1",
      clinicId: "c1",
      patientId: "p1",
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: null,
    };
    state.patient = { id: "p1", telegramId: null };
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "tok",
      telegramId: "111",
      telegramUsername: "patient_handle",
      now: NOW,
    });
    expect(result.kind).toBe("linked");
    expect(state.patientUpdates[0]?.data).toMatchObject({
      telegramId: "111",
      telegramUsername: "patient_handle",
    });
    expect(state.tokenUpdates[0]?.data).toMatchObject({
      consumedAt: NOW,
      consumedTelegramId: "111",
    });
    expect(state.audits[0]?.action).toBe("patient.telegram.invite_consumed");
  });

  it("links re-entry by the same telegramId without overwriting", async () => {
    // Patient already linked to 111; the same user taps the invite again
    // (e.g. after a Telegram reinstall reusing the same account). We don't
    // refuse — telegramId matches, so this is effectively a no-op link.
    state.token = {
      id: "t1",
      clinicId: "c1",
      patientId: "p1",
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: null,
    };
    state.patient = { id: "p1", telegramId: "111" };
    const result = await consumeInviteToken({
      clinicId: "c1",
      token: "tok",
      telegramId: "111",
      now: NOW,
    });
    expect(result.kind).toBe("linked");
    expect(state.patientUpdates).toHaveLength(1);
  });
});
