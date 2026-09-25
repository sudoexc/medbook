import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/crm/conversations/[id]/messages.
 *
 * Audit TG-04: a thread opened from the patient card («Написать в Telegram»,
 * the doctor's «Написать пациенту») had no bot chat id, and the route marked
 * the message DELIVERED (two ticks) without sending anything. It now goes to
 * the patient's chat (a private chat's id is the user's id, the card's
 * telegramId) and is SENT only when Telegram took it, FAILED with a reason
 * otherwise.
 *
 * Audit G6-01: the route sent whatever attachment URL the body named, so a
 * file uploaded in patient A's chat went to patient B. Only files uploaded
 * into this very conversation may leave it.
 *
 * A clinic whose bot was disconnected has no token; send.ts then returns a
 * made up message id, and the route marked the message SENT with it. It is
 * FAILED (bot_not_connected) now, with nothing sent and nothing adopted.
 */

type Conv = {
  id: string;
  channel: string;
  externalId: string | null;
  patientId: string | null;
  patient: { phone: string; telegramId: string | null } | null;
  clinic: { id: string; slug: string; tgBotToken: string | null; tgBotUsername: string };
};

const state = vi.hoisted(() => ({
  conv: null as null | Conv,
  messages: [] as Array<Record<string, unknown>>,
  sends: [] as Array<{ method: string; chatId: string; payload: unknown }>,
  sendError: null as null | string,
  convAdopted: [] as Array<{ where: unknown; data: unknown }>,
  blocked: [] as unknown[],
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
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
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

vi.mock("@/lib/prisma", () => {
  const message = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `m${state.messages.length + 1}`, createdAt: new Date(), ...data };
      state.messages.push(row);
      return row;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.messages.find((m) => m.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    ),
  };
  const conversation = {
    findUnique: vi.fn(async () => state.conv),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
      state.convAdopted.push(args);
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
    async (_clinic: unknown, chatId: string, payload: unknown) => {
      if (state.sendError) throw new Error(state.sendError);
      state.sends.push({ method, chatId: String(chatId), payload });
      return { message_id: 4242, chat: { id: chatId }, date: 0 };
    };
  return {
    sendMessage: call("sendMessage"),
    sendPhoto: call("sendPhoto"),
    sendDocumentUrl: call("sendDocumentUrl"),
  };
});

import { POST } from "@/app/api/crm/conversations/[id]/messages/route";
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

const fileUrl = (conv: string, file = "0b7c2d0e-1111-4222-8333-444455556666.pdf") =>
  `/api/crm/conversations/${conv}/attachments/file?${new URLSearchParams({
    key: `clinics/clinic_A/chat/${conv}/${file}`,
    name: "MRI.pdf",
  })}`;

beforeEach(() => {
  state.conv = coldThread();
  state.messages = [];
  state.sends = [];
  state.sendError = null;
  state.convAdopted = [];
  state.blocked = [];
});

describe("staff message in a thread opened from the patient card (audit TG-04)", () => {
  it("is sent to the patient's Telegram chat and marked SENT with its message id", async () => {
    const res = await post({ body: "Ваши анализы готовы, подойдите завтра к 10:00" });
    expect(res.status).toBe(201);
    expect(state.sends).toEqual([
      expect.objectContaining({ method: "sendMessage", chatId: "777000" }),
    ]);
    const row = await res.json();
    expect(row.status).toBe("SENT");
    expect(row.externalId).toBe("4242");
    // The thread adopts the chat, so the patient's reply lands here.
    expect(state.convAdopted).toEqual([
      { where: { id: "conv_B", externalId: null }, data: { externalId: "777000" } },
    ]);
  });

  it("is FAILED with the reason when the patient blocked the bot, never «delivered»", async () => {
    state.sendError = "Telegram sendMessage failed: 403 Forbidden: bot was blocked by the user";
    const res = await post({ body: "Ваши анализы готовы" });
    const row = await res.json();
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("tg_blocked");
    expect(state.blocked).toHaveLength(1);
  });

  it("is FAILED (no_telegram) without any send when there is no chat to reach", async () => {
    state.conv = coldThread({ patient: { phone: "+998901112233", telegramId: null } });
    const res = await post({ body: "Ваши анализы готовы" });
    const row = await res.json();
    expect(row.status).toBe("FAILED");
    expect(row.failedReason).toBe("no_telegram");
    expect(state.sends).toEqual([]);
  });

  it("an ordinary thread still goes to its own chat id", async () => {
    state.conv = coldThread({ externalId: "555" });
    const res = await post({ body: "Здравствуйте" });
    expect((await res.json()).status).toBe("SENT");
    expect(state.sends[0]!.chatId).toBe("555");
    expect(state.convAdopted).toEqual([]);
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
    expect(state.sends).toEqual([]);
    expect(state.convAdopted).toEqual([]);
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
  it("refuses a file uploaded in another patient's chat, and sends nothing", async () => {
    const res = await post({
      body: "Да, ждём вас завтра в 10:00",
      attachments: [{ kind: "file", url: fileUrl("conv_A"), mimeType: "application/pdf" }],
    });
    expect(res.status).toBe(400);
    expect(state.messages).toEqual([]);
    expect(state.sends).toEqual([]);
  });

  it("sends a file uploaded into this very conversation", async () => {
    const res = await post({
      body: "Результаты МРТ",
      attachments: [{ kind: "file", url: fileUrl("conv_B"), mimeType: "application/pdf" }],
    });
    expect(res.status).toBe(201);
    expect(state.sends.map((s) => s.method)).toEqual(["sendDocumentUrl"]);
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
