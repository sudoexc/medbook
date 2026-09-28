/**
 * Audit TG-11 — Telegram threads and patient cards.
 *
 * Reception links a thread to a card from the inbox's right rail. The PATCH
 * used to write only `Conversation.patientId`: the card never learned its
 * Telegram account, reminders went to «нет канала», and the next message
 * arrived in an unlinked thread again. The link now writes the account onto
 * the card, under the P1 identity rules: one card per account, never taken
 * from a card with history (a TELEGRAM_LINK_CONFLICT task instead), never
 * overwriting the card's own account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  const matches = (row: Record<string, unknown>, where?: Record<string, unknown>): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Array<Record<string, unknown>>).some((w) => matches(row, w));
      if (v && typeof v === "object" && !(v instanceof Date) && "not" in v) {
        return row[k] !== (v as { not: unknown }).not;
      }
      return (row[k] ?? null) === v;
    });
  };
  return {
    matches,
    patients: [] as Array<Record<string, unknown>>,
    conversations: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    conflicts: [] as unknown[],
    retirable: new Set<string>(),
    raceOnLink: false,
  };
});

vi.mock("@/lib/prisma", () => {
  const patient = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = db.patients.find((p) => db.matches(p, where));
      return row ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      if (db.raceOnLink && typeof data.telegramId === "string") {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = db.patients.find((p) => p.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  };
  const conversation = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = db.conversations.find((c) => db.matches(c, where));
      return row ? { ...row } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const rows = db.conversations.filter((c) => db.matches(c, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
  };
  return {
    prisma: {
      patient,
      conversation,
      auditLog: {
        create: vi.fn(async ({ data }: { data: Row }) => {
          db.audits.push(data);
          return data;
        }),
      },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    },
  };
});

vi.mock("@/server/patient/phone-identity", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/patient/phone-identity")>();
  return {
    ...real,
    isRetirableAutoCard: vi.fn(async (_db: unknown, id: string) => db.retirable.has(id)),
  };
});
vi.mock("@/server/patient/telegram-link-conflict", () => ({
  raiseTelegramLinkConflict: vi.fn(async (params: unknown) => {
    db.conflicts.push(params);
  }),
}));
vi.mock("@/lib/api-handler", () => {
  const handler =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      fn: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const parsed = opts.bodySchema?.safeParse(await request.json());
      if (parsed && !parsed.success) return Response.json({ error: "Validation" }, { status: 400 });
      return fn({
        request,
        body: parsed?.data,
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u_reception", role: "RECEPTIONIST" },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));

import { PATCH } from "@/app/api/crm/conversations/[id]/route";
import { threadTelegramId } from "@/server/conversations/link-patient";
import {
  attachThreadToLinkedCard,
  linkThreadToSenderCard,
  privateChatSenderId,
} from "@/server/telegram/thread-patient";
import { prisma } from "@/lib/prisma";

function card(id: string, extra: Row = {}): Row {
  return {
    id,
    clinicId: "clinic_A",
    fullName: `Card ${id}`,
    telegramId: null,
    telegramUsername: null,
    telegramLinkedAt: null,
    deletedAt: null,
    ...extra,
  };
}

function thread(id: string, extra: Row = {}): Row {
  return {
    id,
    clinicId: "clinic_A",
    channel: "TG",
    externalId: "555",
    patientId: null,
    contactUsername: "dilnoza",
    mode: "bot",
    status: "OPEN",
    assignedToId: null,
    unreadCount: 0,
    ...extra,
  };
}

async function patch(conversationId: string, body: Row) {
  const res = await (PATCH as unknown as (r: Request) => Promise<Response>)(
    new Request(`https://crm.test/api/crm/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Row };
}

const p = (id: string) => db.patients.find((r) => r.id === id)!;
const c = (id: string) => db.conversations.find((r) => r.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  db.patients = [];
  db.conversations = [];
  db.audits = [];
  db.conflicts = [];
  db.retirable = new Set();
  db.raceOnLink = false;
});

describe("linking a thread from the right rail writes the card's Telegram", () => {
  it("the card learns the account (id, username, first-link time) and an audit row is written", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(thread("conv_1"));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.status).toBe(200);
    expect(res.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: null });
    expect(c("conv_1").patientId).toBe("p1");
    expect(p("p1")).toMatchObject({ telegramId: "555", telegramUsername: "dilnoza" });
    expect(p("p1").telegramLinkedAt).toBeInstanceOf(Date);
    expect(db.audits).toEqual([
      expect.objectContaining({
        action: "patient.telegram.inbox_linked",
        entityId: "p1",
        actorId: "u_reception",
      }),
    ]);
  });

  it("a card bound to another account keeps it; the thread is still linked and the rail is told", async () => {
    db.patients.push(card("p1", { telegramId: "999" }));
    db.conversations.push(thread("conv_1"));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({ kind: "card-has-other-telegram" });
    expect(c("conv_1").patientId).toBe("p1");
    expect(p("p1").telegramId).toBe("999");
    expect(db.audits).toEqual([]);
  });

  it("the account's empty Mini App card is retired and its threads follow", async () => {
    db.patients.push(card("p1"), card("p_auto", { telegramId: "555" }));
    db.conversations.push(thread("conv_1"), thread("conv_inapp", { externalId: null, patientId: "p_auto" }));
    db.retirable.add("p_auto");
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({ kind: "linked", retiredPatientId: "p_auto" });
    expect(p("p1").telegramId).toBe("555");
    expect(p("p_auto")).toMatchObject({ telegramId: null, deletionReason: "duplicate_of:p1" });
    expect(p("p_auto").deletedAt).toBeInstanceOf(Date);
    expect(c("conv_inapp").patientId).toBe("p1");
  });

  it("never takes the account from a card with history: nothing written, reception gets a task", async () => {
    db.patients.push(card("p1"), card("p_mother", { telegramId: "555", fullName: "Каримова Мунира" }));
    db.conversations.push(thread("conv_1"));
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.json.telegramLink).toEqual({
      kind: "telegram-on-other-card",
      otherPatientId: "p_mother",
      otherPatientName: "Каримова Мунира",
    });
    expect(p("p1").telegramId).toBeNull();
    expect(p("p_mother").telegramId).toBe("555");
    expect(db.conflicts).toEqual([
      expect.objectContaining({
        clinicId: "clinic_A",
        telegramId: "555",
        telegramCard: expect.objectContaining({ id: "p_mother", fullName: "Каримова Мунира" }),
        clinicCard: { id: "p1", fullName: "Card p1" },
        via: "inbox",
      }),
    ]);
    // The thread link itself is reception's call and stays.
    expect(c("conv_1").patientId).toBe("p1");
  });

  it("a concurrent Mini App first open that wins the unique index changes nothing", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(thread("conv_1"));
    db.raceOnLink = true;
    const res = await patch("conv_1", { patientId: "p1" });
    expect(res.status).toBe(200);
    expect(res.json.telegramLink).toMatchObject({ kind: "telegram-on-other-card" });
    expect(p("p1").telegramId).toBeNull();
  });

  it("a card of another clinic, or a deleted one, cannot be linked", async () => {
    db.patients.push(card("p_B", { clinicId: "clinic_B" }), card("p_gone", { deletedAt: new Date() }));
    db.conversations.push(thread("conv_1"));
    expect((await patch("conv_1", { patientId: "p_B" })).status).toBe(404);
    expect((await patch("conv_1", { patientId: "p_gone" })).status).toBe(404);
    expect(c("conv_1").patientId).toBeNull();
  });

  it("a group thread carries no one's account: only the thread is linked", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(thread("conv_g", { externalId: "-1001234" }));
    const res = await patch("conv_g", { patientId: "p1" });
    expect(res.json.telegramLink).toBeNull();
    expect(c("conv_g").patientId).toBe("p1");
    expect(p("p1").telegramId).toBeNull();
  });

  it("other edits (status, tags) never touch a card", async () => {
    db.patients.push(card("p1"));
    db.conversations.push(thread("conv_1", { patientId: "p1" }));
    const res = await patch("conv_1", { status: "CLOSED" });
    expect(res.json.telegramLink).toBeNull();
    expect(prisma.patient.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ telegramId: "555" }) }),
    );
    expect(p("p1").telegramId).toBeNull();
  });
});

describe("threadTelegramId", () => {
  it("only a private TG chat carries an account", () => {
    expect(threadTelegramId({ channel: "TG", externalId: "555" })).toBe("555");
    expect(threadTelegramId({ channel: "TG", externalId: "-1001234" })).toBeNull();
    expect(threadTelegramId({ channel: "TG", externalId: null })).toBeNull();
    expect(threadTelegramId({ channel: "CALL", externalId: "555" })).toBeNull();
  });
});

describe("bot thread ↔ the sender's card (webhook helpers)", () => {
  it("privateChatSenderId: the sender only in his own private chat", () => {
    expect(privateChatSenderId("555", 555)).toBe("555");
    expect(privateChatSenderId("-1001234", 555)).toBeNull();
    expect(privateChatSenderId("555", undefined)).toBeNull();
  });

  it("an unlinked thread is tied to the card holding the sender's account", async () => {
    db.patients.push(card("p1", { telegramId: "555" }));
    db.conversations.push(thread("conv_1"));
    const linked = await linkThreadToSenderCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_1",
      telegramId: "555",
    });
    expect(linked).toBe("p1");
    expect(c("conv_1").patientId).toBe("p1");
  });

  it("a thread reception linked by hand keeps its card", async () => {
    db.patients.push(card("p_son", { telegramId: "555" }));
    db.conversations.push(thread("conv_1", { patientId: "p_mother" }));
    const linked = await linkThreadToSenderCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_1",
      telegramId: "555",
    });
    expect(linked).toBeNull();
    expect(c("conv_1").patientId).toBe("p_mother");
  });

  it("no card for the account: the thread stays unlinked", async () => {
    db.conversations.push(thread("conv_1"));
    expect(
      await linkThreadToSenderCard(prisma, {
        clinicId: "clinic_A",
        conversationId: "conv_1",
        telegramId: "555",
      }),
    ).toBeNull();
  });

  it("after a retire, the retired card's threads move with the account", async () => {
    db.conversations.push(
      thread("conv_bot", { patientId: "p_auto" }),
      thread("conv_inapp", { externalId: null, patientId: "p_auto" }),
      thread("conv_other", { externalId: "777", patientId: "p_other" }),
    );
    const attached = await attachThreadToLinkedCard(prisma, {
      clinicId: "clinic_A",
      conversationId: "conv_bot",
      patientId: "p1",
      retiredPatientId: "p_auto",
    });
    expect(attached).toBe(true);
    expect(c("conv_bot").patientId).toBe("p1");
    expect(c("conv_inapp").patientId).toBe("p1");
    expect(c("conv_other").patientId).toBe("p_other");
  });
});
