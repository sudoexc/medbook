import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-04 in the thread kernel: a thread the clinic opens from the
 * patient card is bound to the patient's Telegram chat (in a private chat
 * the chat id is the user id, the card's telegramId), so staff messages are
 * really sent there and the patient's reply comes back to the same thread.
 * When that chat already belongs to another thread (unique per clinic), the
 * new one stays unbound and the send route reaches the patient by telegramId.
 */

const state = vi.hoisted(() => ({
  patient: { id: "p1", telegramId: "777000" as string | null },
  existing: null as null | { id: string; channel: string },
  chatOwner: null as null | { id: string; channel: string; patientId: string | null },
  creates: [] as Array<Record<string, unknown>>,
  adopted: [] as Array<{ where: unknown; data: unknown }>,
  failFirstCreateWith: null as null | string,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    conversation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.creates.push(data);
        if (state.failFirstCreateWith && state.creates.length === 1) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: state.failFirstCreateWith,
          });
        }
        return { id: `conv_${state.creates.length}`, channel: "TG" };
      }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return {
    prisma: {
      patient: { findFirst: vi.fn(async () => state.patient) },
      conversation: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (!("externalId" in where)) return state.existing;
          // The unlinked-bot-chat lookup asks for `patientId: null`.
          if ("patientId" in where && where.patientId === null) {
            return state.chatOwner && state.chatOwner.patientId === null
              ? state.chatOwner
              : null;
          }
          return state.chatOwner;
        }),
        updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
          state.adopted.push(args);
          return { count: 1 };
        }),
      },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_1",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));

import { findOrCreateConversation } from "@/server/conversations/find-or-create";

const input = {
  clinicId: "clinic_A",
  patientId: "p1",
  initiatorRole: "RECEPTIONIST" as const,
  initiatorUserId: "u1",
};

beforeEach(() => {
  state.patient = { id: "p1", telegramId: "777000" };
  state.existing = null;
  state.chatOwner = null;
  state.creates = [];
  state.adopted = [];
  state.failFirstCreateWith = null;
});

describe("findOrCreateConversation — cold start binds the Telegram chat", () => {
  it("creates the thread with externalId = the patient's telegramId", async () => {
    const res = await findOrCreateConversation(input);
    expect(res).toMatchObject({ ok: true, created: true });
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0]).toMatchObject({ patientId: "p1", externalId: "777000" });
  });

  it("leaves it unbound when a thread linked to another card already owns that chat", async () => {
    state.chatOwner = { id: "conv_bot", channel: "TG", patientId: "p_mother" };
    await findOrCreateConversation(input);
    expect(state.adopted).toEqual([]);
    expect(state.creates[0]).toMatchObject({ externalId: null });
  });

  it("retries unbound when the patient's own first message wins the race", async () => {
    state.failFirstCreateWith = "P2002";
    const res = await findOrCreateConversation(input);
    expect(res.ok).toBe(true);
    expect(state.creates.map((c) => c.externalId)).toEqual(["777000", null]);
  });

  it("still refuses a patient with no Telegram", async () => {
    state.patient = { id: "p1", telegramId: null };
    expect(await findOrCreateConversation(input)).toEqual({
      ok: false,
      reason: "no_channel",
    });
    expect(state.creates).toEqual([]);
  });
});

/**
 * Audit TG-11: the patient's own bot chat, which nobody linked to his card,
 * is his thread. A second «cold» thread next to it split his history and
 * his replies kept landing in the one staff never opened.
 */
describe("findOrCreateConversation — the patient's unlinked bot chat", () => {
  it("is tied to the patient and returned instead of a new thread", async () => {
    state.chatOwner = { id: "conv_bot", channel: "TG", patientId: null };
    const res = await findOrCreateConversation(input);
    expect(res).toMatchObject({ ok: true, created: false, conversation: { id: "conv_bot" } });
    expect(state.adopted).toEqual([
      {
        where: { id: "conv_bot", clinicId: "clinic_A", patientId: null },
        data: { patientId: "p1" },
      },
    ]);
    expect(state.creates).toEqual([]);
  });

  it("a thread already linked to the patient still wins, untouched", async () => {
    state.existing = { id: "conv_linked", channel: "TG" };
    state.chatOwner = { id: "conv_bot", channel: "TG", patientId: null };
    const res = await findOrCreateConversation(input);
    expect(res).toMatchObject({ ok: true, created: false, conversation: { id: "conv_linked" } });
    expect(state.adopted).toEqual([]);
  });
});
