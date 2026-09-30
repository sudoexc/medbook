import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A staff message leaving the CRM chat.
 *
 * Audit TG-17: POST /api/crm/conversations/[id]/messages waited for Telegram
 * inside the request. Over the slow egress a send took up to two minutes,
 * nginx answered 504 at 60s, the operator sent again and the patient got the
 * message two or three times. The route now saves the row QUEUED, hands it
 * to the send worker and answers at once; the worker claims it, sends it
 * once (never repeating a request Telegram may already have taken) and
 * records SENT / FAILED on the realtime bus. «Повторить» re-queues a FAILED
 * row, once.
 *
 * Audit TG-04: a thread opened from the patient card («Написать в Telegram»,
 * the doctor's «Написать пациенту») had no bot chat id, and the route marked
 * the message DELIVERED (two ticks) without sending anything. It goes to the
 * patient's chat (a private chat's id is the user's id, the card's
 * telegramId) and is SENT only when Telegram took it, FAILED with a reason
 * otherwise.
 *
 * Audit G6-01: only files uploaded into this very conversation may leave it.
 * A disconnected bot: FAILED (bot_not_connected), nothing sent or adopted.
 * Audit G6-04: a text still carrying `{{...}}` fields is refused.
 * Audit G6-03: a reply that reached the patient takes the thread out of
 * «Неотвеченные»; a question asked while it was queued keeps it there.
 */

type Conv = {
  id: string;
  channel: string;
  externalId: string | null;
  patientId: string | null;
  patient: { phone: string; telegramId: string | null } | null;
  clinic: { id: string; slug: string; tgBotToken: string | null; tgBotUsername: string };
};

type Row = Record<string, unknown> & {
  id: string;
  status: string;
  createdAt: Date;
};

const state = vi.hoisted(() => ({
  conv: null as null | Conv,
  messages: [] as Array<Record<string, unknown> & { id: string; status: string; createdAt: Date }>,
  sends: [] as Array<{ method: string; chatId: string; opts: unknown }>,
  sendError: null as null | string,
  convUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  blocked: [] as unknown[],
  enqueued: [] as Array<{ queue: string; job: string; data: unknown }>,
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  takenExternalIds: new Set<string>(),
  /** The next N SENT writes throw (a lock timeout after Telegram took it). */
  sentWriteFailures: 0,
  /** Clearing «Неотвеченные» throws. */
  failAwaitingClear: false,
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
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u1", role: "RECEPTIONIST" },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/tenant-context", () => ({
  getTenant: () => ({ kind: "TENANT", clinicId: "clinic_A" }),
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_clinicId: string, e: { type: string; payload: Record<string, unknown> }) => {
    state.events.push(e);
  }),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async (queue: string, job: string, data: unknown) => {
    state.enqueued.push({ queue, job, data });
  }),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
}));
vi.mock("@/server/crypto/secrets", async (importOriginal) => {
  // A real envelope that no longer decrypts: the key was rotated.
  const real = await importOriginal<typeof import("@/server/crypto/secrets")>();
  return {
    ...real,
    decrypt: (v: string) => {
      if (v === "v1:iv:tag:rotated") throw new Error("decrypt: auth tag mismatch");
      return real.decrypt(v);
    },
  };
});

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    const cur = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const c = v as { lt?: Date; lte?: Date; gt?: Date; gte?: Date; in?: unknown[] };
      if (c.in && !c.in.includes(cur)) return false;
      if (c.lt && !((cur as Date) < c.lt)) return false;
      if (c.lte && !((cur as Date) <= c.lte)) return false;
      if (c.gt && !((cur as Date) > c.gt)) return false;
      if (c.gte && !((cur as Date) >= c.gte)) return false;
      continue;
    }
    if (cur !== v) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => {
  const message = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `m${state.messages.length + 1}`,
        createdAt: new Date(),
        failedReason: null,
        externalId: null,
        ...data,
      } as unknown as Row;
      state.messages.push(row);
      // A copy, as Prisma returns: later writes do not reach the caller's object.
      return { ...row };
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.messages.find((m) => m.id === where.id)!;
        if (data.status === "SENT" && state.sentWriteFailures > 0) {
          state.sentWriteFailures -= 1;
          throw new Error("canceling statement due to lock timeout");
        }
        if (typeof data.externalId === "string" && state.takenExternalIds.has(data.externalId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        Object.assign(row, data);
        return { ...row };
      },
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of state.messages) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = state.messages.find((m) => m.id === where.id);
      return row ? { ...row } : null;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      // Rows here carry no clinicId (the tenant extension adds it).
      const rest = { ...where };
      delete rest.clinicId;
      const row = state.messages.find((m) => matches(m, rest));
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return state.messages
        .filter((m) => matches(m, where))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => ({ ...m, conversation: { patientId: state.conv?.patientId ?? null } }));
    }),
  };
  const conversation = {
    findUnique: vi.fn(async () => state.conv),
    findFirst: vi.fn(async () => state.conv),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (state.failAwaitingClear && "awaitingReplySince" in args.data) {
        throw new Error("Can't reach database server");
      }
      state.convUpdates.push(args);
      return { count: 1 };
    }),
  };
  return {
    prisma: {
      message,
      conversation,
      patient: {
        updateMany: vi.fn(async (args: unknown) => {
          state.blocked.push(args);
          return { count: 1 };
        }),
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ message, conversation }),
    },
  };
});

vi.mock("@/server/telegram/send", () => {
  const call =
    (method: string) =>
    async (_clinic: unknown, chatId: string, ...rest: unknown[]) => {
      if (state.sendError) throw new Error(state.sendError);
      state.sends.push({ method, chatId: String(chatId), opts: rest[rest.length - 1] });
      return { message_id: 4242, chat: { id: chatId }, date: 0 };
    };
  return {
    sendMessage: call("sendMessage"),
    sendPhoto: call("sendPhoto"),
    sendDocumentUrl: call("sendDocumentUrl"),
  };
});

import { POST } from "@/app/api/crm/conversations/[id]/messages/route";
import { POST as RETRY } from "@/app/api/crm/conversations/[id]/messages/[messageId]/retry/route";
import {
  deliverStaffMessage,
  QUEUED_EXPIRE_MS,
  SENDING_STUCK_MS,
  sweepStaffMessages,
} from "@/server/conversations/staff-dispatch";
import {
  clinicBotConnected,
  isOwnChatAttachmentUrl,
} from "@/server/conversations/staff-send";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";

const CLINIC = { id: "clinic_A", slug: "alpha", tgBotToken: "T", tgBotUsername: "bot" };

function coldThread(overrides: Partial<Conv> = {}): Conv {
  return {
    id: "conv_B",
    channel: "TG",
    externalId: null,
    patientId: "p_B",
    patient: { phone: "+998901112233", telegramId: "777000" },
    clinic: CLINIC,
    ...overrides,
  };
}

function post(body: Record<string, unknown>, conversationId = "conv_B") {
  return (POST as unknown as (r: Request) => Promise<Response>)(
    new Request(`https://crm.test/api/crm/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function retry(messageId: string, conversationId = "conv_B") {
  return (RETRY as unknown as (r: Request) => Promise<Response>)(
    new Request(
      `https://crm.test/api/crm/conversations/${conversationId}/messages/${messageId}/retry`,
      { method: "POST" },
    ),
  );
}

/** POST, then let the worker run every job the route queued. */
async function sendAndDeliver(body: Record<string, unknown>) {
  const res = await post(body);
  const queued = await res.json();
  for (const e of state.enqueued.splice(0)) {
    await deliverStaffMessage(e.data as { messageId: string });
  }
  const row = state.messages.find((m) => m.id === queued.id);
  return { res, queued, row: row ? { ...row } : queued };
}

const fileUrl = (conv: string, file = "0b7c2d0e-1111-4222-8333-444455556666.pdf") =>
  `/api/crm/conversations/${conv}/attachments/file?${new URLSearchParams({
    key: `clinics/clinic_A/chat/${conv}/${file}`,
    name: "MRI.pdf",
  })}`;

const savedRedis = process.env.REDIS_URL;
beforeAll(() => {
  // Production shape: the route hands the row to the BullMQ worker.
  process.env.REDIS_URL = "redis://test:6379";
});
afterAll(() => {
  if (savedRedis === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedis;
});

beforeEach(() => {
  state.conv = coldThread();
  state.messages = [];
  state.sends = [];
  state.sendError = null;
  state.convUpdates = [];
  state.blocked = [];
  state.enqueued = [];
  state.events = [];
  state.takenExternalIds = new Set();
  state.sentWriteFailures = 0;
  state.failAwaitingClear = false;
});

const adoptions = () =>
  state.convUpdates.filter((u) => "externalId" in u.data);

describe("sending is queued, never inside the request (audit TG-17)", () => {
  it("answers 201 with the row QUEUED and hands it to the worker, without calling Telegram", async () => {
    const res = await post({ body: "Ждём вас в 15:00" });
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.status).toBe("QUEUED");
    expect(state.sends).toEqual([]);
    expect(state.enqueued).toEqual([
      {
        queue: "conversations:send",
        job: "deliver",
        data: { messageId: row.id, publicBase: "https://crm.test" },
      },
    ]);
    // Other tabs see the queued message at once.
    expect(state.events.at(-1)).toMatchObject({
      type: "tg.message.new",
      payload: { messageId: row.id, direction: "OUT", status: "QUEUED" },
    });
  });

  it("the worker sends it once and announces SENT; a duplicate job sends nothing", async () => {
    const { queued, row } = await sendAndDeliver({ body: "Ждём вас в 15:00" });
    expect(row.status).toBe("SENT");
    expect(state.sends).toHaveLength(1);
    expect(state.events.at(-1)).toMatchObject({
      type: "tg.message.new",
      payload: { messageId: queued.id, status: "SENT" },
    });
    // BullMQ redelivery, the sweep, a second worker: the claim is gone.
    expect(await deliverStaffMessage({ messageId: queued.id })).toBe("skipped");
    expect(state.sends).toHaveLength(1);
  });

  it("asks Telegram for one attempt per request that may have arrived", async () => {
    await sendAndDeliver({ body: "Ждём вас в 15:00" });
    expect(state.sends[0]!.opts).toMatchObject({
      delivery: { retryUncertain: false },
    });
  });

  it("no answer from Telegram → FAILED tg_timeout, sent once, not repeated", async () => {
    state.sendError = "Telegram sendMessage outcome unknown: The operation was aborted due to timeout";
    const { row } = await sendAndDeliver({ body: "Ждём вас в 15:00" });
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("tg_timeout");
    expect(state.enqueued).toEqual([]);
  });

  it("without Redis the send runs in this process, after the response", async () => {
    delete process.env.REDIS_URL;
    try {
      const res = await post({ body: "Ждём вас в 15:00" });
      expect((await res.json()).status).toBe("QUEUED");
      expect(state.enqueued).toEqual([]);
      await new Promise((r) => setTimeout(r, 0));
      expect(state.sends).toHaveLength(1);
      expect(state.messages[0]!.status).toBe("SENT");
    } finally {
      process.env.REDIS_URL = "redis://test:6379";
    }
  });

  it("a Telegram message id another chat already holds still reads SENT", async () => {
    state.takenExternalIds.add("4242");
    const { row } = await sendAndDeliver({ body: "Здравствуйте" });
    expect(row.status).toBe("SENT");
  });
});

describe("a DB hiccup after Telegram took the message (review of TG-17)", () => {
  /** The chat never shows «Не доставлено» for a message the patient has. */
  const failedEvents = () =>
    state.events.filter((e) => e.payload.status === "FAILED");

  it("clearing «Неотвеченные» fails: the row stays SENT, no «Повторить»", async () => {
    state.failAwaitingClear = true;
    const res = await post({ body: "Да, можно в 15:00" });
    const queued = await res.json();
    const [job] = state.enqueued.splice(0);
    expect(await deliverStaffMessage(job!.data as { messageId: string })).toBe("sent");
    expect(state.messages[0]).toMatchObject({ status: "SENT", externalId: "4242" });
    expect(state.messages[0]!.failedReason ?? null).toBeNull();
    expect(state.sends).toHaveLength(1);
    expect(failedEvents()).toEqual([]);
    expect(state.events.at(-1)).toMatchObject({
      payload: { messageId: queued.id, status: "SENT" },
    });
    // Nothing to retry: «Повторить» is refused for a SENT row.
    expect((await retry(queued.id)).status).toBe(409);
    expect(state.sends).toHaveLength(1);
  });

  it("the SENT write fails once: written on the second try, never FAILED", async () => {
    state.sentWriteFailures = 1;
    const res = await post({ body: "Да, можно в 15:00" });
    await res.json();
    const [job] = state.enqueued.splice(0);
    expect(await deliverStaffMessage(job!.data as { messageId: string })).toBe("sent");
    expect(state.messages[0]).toMatchObject({ status: "SENT", externalId: "4242" });
    expect(failedEvents()).toEqual([]);
    expect(state.sends).toHaveLength(1);
  });

  it("the SENT write keeps failing: left SENDING for the sweep, never FAILED tg_error", async () => {
    state.sentWriteFailures = 2;
    const res = await post({ body: "Да, можно в 15:00" });
    await res.json();
    const [job] = state.enqueued.splice(0);
    expect(await deliverStaffMessage(job!.data as { messageId: string })).toBe("sent");
    expect(state.messages[0]!.status).toBe("SENDING");
    expect(state.messages[0]!.failedReason ?? null).toBeNull();
    expect(failedEvents()).toEqual([]);
    expect(state.sends).toHaveLength(1);
  });
});

describe("«Повторить» on a failed message (audit TG-17)", () => {
  it("re-queues the same row once, at the bottom of the thread", async () => {
    state.sendError = "Telegram sendMessage failed: 400 Bad Request: something";
    const { queued, row } = await sendAndDeliver({ body: "Ждём вас в 15:00" });
    expect(row.status).toBe("FAILED");
    const before = state.messages[0]!.createdAt;

    state.sendError = null;
    await new Promise((r) => setTimeout(r, 2));
    const res = await retry(queued.id);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("QUEUED");
    expect(state.messages[0]!.createdAt.getTime()).toBeGreaterThan(before.getTime());
    expect(state.enqueued).toHaveLength(1);

    // A double click finds it no longer FAILED.
    expect((await retry(queued.id)).status).toBe(409);
    expect(state.enqueued).toHaveLength(1);

    await deliverStaffMessage(state.enqueued[0]!.data as { messageId: string });
    expect(state.messages[0]!.status).toBe("SENT");
    expect(state.sends).toHaveLength(1);
  });

  it("refuses a message that did not fail, and the bot's own messages", async () => {
    const { queued } = await sendAndDeliver({ body: "Здравствуйте" });
    expect((await retry(queued.id)).status).toBe(409);
    state.messages.push({
      id: "bot1",
      conversationId: "conv_B",
      direction: "OUT",
      senderId: null,
      origin: "notification",
      status: "FAILED",
      createdAt: new Date(),
    });
    expect((await retry("bot1")).status).toBe(409);
  });

  it("a thread that still cannot send answers with the reason and stays FAILED", async () => {
    state.sendError = "Telegram sendMessage failed: 400 Bad Request: something";
    const { queued } = await sendAndDeliver({ body: "Здравствуйте" });
    state.conv = coldThread({ clinic: { ...CLINIC, tgBotToken: null } });
    const res = await retry(queued.id);
    const row = await res.json();
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("bot_not_connected");
    expect(state.enqueued).toEqual([]);
  });
});

describe("the sweep (audit TG-17)", () => {
  it("re-queues a lost job, closes a stale QUEUED and a stuck SENDING row", async () => {
    const now = new Date();
    const at = (msAgo: number) => new Date(now.getTime() - msAgo);
    state.messages.push(
      { id: "lost", conversationId: "conv_B", direction: "OUT", status: "QUEUED", createdAt: at(60_000) },
      { id: "fresh", conversationId: "conv_B", direction: "OUT", status: "QUEUED", createdAt: at(2_000) },
      { id: "stale", conversationId: "conv_B", direction: "OUT", status: "QUEUED", createdAt: at(QUEUED_EXPIRE_MS + 60_000) },
      { id: "stuck", conversationId: "conv_B", direction: "OUT", status: "SENDING", createdAt: at(SENDING_STUCK_MS + 60_000) },
      { id: "busy", conversationId: "conv_B", direction: "OUT", status: "SENDING", createdAt: at(30_000) },
    );
    const r = await sweepStaffMessages(now);
    expect(r).toEqual({ requeued: 1, expired: 1, stuck: 1 });
    expect(state.enqueued.map((e) => (e.data as { messageId: string }).messageId)).toEqual(["lost"]);
    const byId = Object.fromEntries(state.messages.map((m) => [m.id, m]));
    expect(byId.stale).toMatchObject({ status: "FAILED", failedReason: "not_sent" });
    expect(byId.stuck).toMatchObject({ status: "FAILED", failedReason: "tg_timeout" });
    expect(byId.busy!.status).toBe("SENDING");
    expect(byId.fresh!.status).toBe("QUEUED");
  });
});

describe("a reply that reached the patient answers the thread (audit G6-03)", () => {
  it("clears «Неотвеченные» for questions asked before the reply", async () => {
    await sendAndDeliver({ body: "Да, можно в 15:00" });
    const clear = state.convUpdates.find((u) => "awaitingReplySince" in u.data);
    expect(clear?.where).toMatchObject({ id: "conv_B" });
    expect(clear?.data).toEqual({ awaitingReplySince: null });
  });

  it("keeps the thread waiting from a question that came in while the reply was queued", async () => {
    const res = await post({ body: "Да, можно в 15:00" });
    const queued = await res.json();
    const asked = new Date(Date.now() + 5);
    state.messages.push({
      id: "in1",
      conversationId: "conv_B",
      direction: "IN",
      body: "А на завтра?",
      status: "DELIVERED",
      createdAt: asked,
    });
    await deliverStaffMessage({ messageId: queued.id });
    const clear = state.convUpdates.find((u) => "awaitingReplySince" in u.data);
    expect(clear?.data).toEqual({ awaitingReplySince: asked });
  });

  it("a failed send answers nothing", async () => {
    state.sendError = "Telegram sendMessage failed: 400 Bad Request: something";
    await sendAndDeliver({ body: "Да, можно в 15:00" });
    expect(state.convUpdates.some((u) => "awaitingReplySince" in u.data)).toBe(false);
  });
});

describe("staff message in a thread opened from the patient card (audit TG-04)", () => {
  it("is sent to the patient's Telegram chat and marked SENT with its message id", async () => {
    const { res, row } = await sendAndDeliver({
      body: "Ваши анализы готовы, подойдите завтра к 10:00",
    });
    expect(res.status).toBe(201);
    expect(state.sends).toEqual([
      expect.objectContaining({ method: "sendMessage", chatId: "777000" }),
    ]);
    expect(row.status).toBe("SENT");
    expect(row.externalId).toBe("4242");
    // The thread adopts the chat, so the patient's reply lands here.
    expect(adoptions()).toEqual([
      { where: { id: "conv_B", externalId: null }, data: { externalId: "777000" } },
    ]);
  });

  it("is FAILED with the reason when the patient blocked the bot, never «delivered»", async () => {
    state.sendError = "Telegram sendMessage failed: 403 Forbidden: bot was blocked by the user";
    const { row } = await sendAndDeliver({ body: "Ваши анализы готовы" });
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("tg_blocked");
    expect(state.blocked).toHaveLength(1);
    expect(state.events.at(-1)).toMatchObject({
      payload: { status: "FAILED", failedReason: "tg_blocked" },
    });
  });

  it("final review: a Mini App user who never pressed Start reads it in the app → DELIVERED, reason kept", async () => {
    state.sendError =
      "Telegram sendMessage failed: 403 Forbidden: bot can't initiate conversation with a user";
    const { row } = await sendAndDeliver({ body: "Ваши анализы готовы" });
    expect(row.status).toBe("DELIVERED");
    expect(row.failedReason).toBe("tg_not_started");
    expect(state.blocked).toHaveLength(0);
  });

  it("is FAILED (no_telegram) at once, nothing queued or sent, when there is no chat to reach", async () => {
    state.conv = coldThread({ patient: { phone: "+998901112233", telegramId: null } });
    const res = await post({ body: "Ваши анализы готовы" });
    const row = await res.json();
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("no_telegram");
    expect(state.enqueued).toEqual([]);
    expect(state.sends).toEqual([]);
  });

  it("an ordinary thread still goes to its own chat id", async () => {
    state.conv = coldThread({ externalId: "555" });
    const { row } = await sendAndDeliver({ body: "Здравствуйте" });
    expect(row.status).toBe("SENT");
    expect(state.sends[0]!.chatId).toBe("555");
    expect(adoptions()).toEqual([]);
  });
});

describe("staff message while the clinic bot is disconnected", () => {
  beforeEach(() => vi.mocked(bumpPatientLastContact).mockClear());

  it("is FAILED (bot_not_connected), sends nothing and adopts no chat", async () => {
    state.conv = coldThread({ clinic: { ...CLINIC, tgBotToken: null } });
    const res = await post({ body: "Ваши анализы готовы" });
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("bot_not_connected");
    expect(row.externalId ?? null).toBeNull();
    expect(state.enqueued).toEqual([]);
    expect(state.sends).toEqual([]);
    expect(adoptions()).toEqual([]);
    expect(bumpPatientLastContact).not.toHaveBeenCalled();
  });

  it("is FAILED the same way in a bound thread and with an attachment", async () => {
    state.conv = coldThread({ externalId: "555", clinic: { ...CLINIC, tgBotToken: null } });
    const res = await post({
      body: "Результаты МРТ",
      attachments: [{ kind: "file", url: fileUrl("conv_B"), mimeType: "application/pdf" }],
    });
    const row = await res.json();
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("bot_not_connected");
    expect(state.sends).toEqual([]);
  });

  it("a bot disconnected while the message waited in the queue: FAILED, nothing sent", async () => {
    const res = await post({ body: "Здравствуйте" });
    const queued = await res.json();
    state.conv = coldThread({ clinic: { ...CLINIC, tgBotToken: null } });
    expect(await deliverStaffMessage({ messageId: queued.id })).toBe("failed");
    expect(state.messages[0]).toMatchObject({ status: "FAILED", failedReason: "bot_not_connected" });
    expect(state.sends).toEqual([]);
  });

  it("treats an emptied or undecryptable token as not connected", async () => {
    state.conv = coldThread({ clinic: { ...CLINIC, tgBotToken: "" } });
    expect((await (await post({ body: "Здравствуйте" })).json()).failedReason).toBe(
      "bot_not_connected",
    );
    expect(clinicBotConnected(null)).toBe(false);
    expect(clinicBotConnected("")).toBe(false);
    expect(clinicBotConnected("v1:iv:tag:rotated")).toBe(false);
    expect(clinicBotConnected("123456:AA-legacy-plaintext")).toBe(true);
    expect(state.sends).toEqual([]);
  });
});

describe("attachments are bound to their conversation (audit G6-01)", () => {
  it("refuses a file uploaded in another patient's chat, and saves or sends nothing", async () => {
    const res = await post({
      body: "Да, ждём вас завтра в 10:00",
      attachments: [{ kind: "file", url: fileUrl("conv_A"), mimeType: "application/pdf" }],
    });
    expect(res.status).toBe(400);
    expect(state.messages).toEqual([]);
    expect(state.enqueued).toEqual([]);
    expect(state.sends).toEqual([]);
  });

  it("sends a file uploaded into this very conversation, by its public URL", async () => {
    const { res } = await sendAndDeliver({
      body: "Результаты МРТ",
      attachments: [{ kind: "file", url: fileUrl("conv_B"), mimeType: "application/pdf" }],
    });
    expect(res.status).toBe(201);
    expect(state.sends.map((s) => s.method)).toEqual(["sendDocumentUrl"]);
  });
});

describe("a template field never reaches the patient as braces (audit G6-04)", () => {
  it("refuses a text still carrying {{...}} fields, names them, and saves or sends nothing", async () => {
    const res = await post({
      body: "{{patient.firstName}}, напоминаем: завтра в {{ appointment.time }} вы записаны",
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "UnfilledPlaceholders",
      fields: ["patient.firstName", "appointment.time"],
    });
    expect(state.messages).toEqual([]);
    expect(state.sends).toEqual([]);
  });

  it("still sends ordinary text with braces that are not template fields", async () => {
    const { res } = await sendAndDeliver({ body: "Смайлик {} и {скобки} не поля шаблона" });
    expect(res.status).toBe(201);
    expect(state.sends).toHaveLength(1);
  });
});

describe("isOwnChatAttachmentUrl", () => {
  const scope = { clinicId: "clinic_A", conversationId: "conv_B" };

  it("accepts the storage proxy URL and the dev stub path of this conversation", () => {
    expect(isOwnChatAttachmentUrl(fileUrl("conv_B"), scope)).toBe(true);
    expect(isOwnChatAttachmentUrl("/uploads/chat/clinic_A/conv_B/abc-1.png", scope)).toBe(true);
  });

  it("refuses anything else", () => {
    // Another conversation's file, even behind this conversation's path.
    expect(
      isOwnChatAttachmentUrl(
        `/api/crm/conversations/conv_B/attachments/file?key=clinics/clinic_A/chat/conv_A/x.pdf`,
        scope,
      ),
    ).toBe(false);
    expect(isOwnChatAttachmentUrl(fileUrl("conv_A"), scope)).toBe(false);
    // Another clinic, a traversal, an outside URL.
    expect(
      isOwnChatAttachmentUrl(
        `/api/crm/conversations/conv_B/attachments/file?key=clinics/clinic_Z/chat/conv_B/x.pdf`,
        scope,
      ),
    ).toBe(false);
    expect(
      isOwnChatAttachmentUrl(
        `/api/crm/conversations/conv_B/attachments/file?key=clinics/clinic_A/chat/conv_B/../conv_A/x.pdf`,
        scope,
      ),
    ).toBe(false);
    expect(isOwnChatAttachmentUrl("https://evil.example/x.pdf", scope)).toBe(false);
    expect(isOwnChatAttachmentUrl("//evil.example/x.pdf", scope)).toBe(false);
    expect(isOwnChatAttachmentUrl("/uploads/chat/clinic_A/conv_A/x.png", scope)).toBe(false);
  });
});
