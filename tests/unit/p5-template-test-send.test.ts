/**
 * Audit UX-10: the notification template editor.
 *
 *   - Email was offered as a channel, but the send worker delivers no email:
 *     every send of such a template went FAILED and grew the red counter.
 *     The editor offers Telegram only, and the API refuses to create, switch
 *     to or switch on an EMAIL template.
 *   - «Тестовая отправка» queued a send for patientId "dev-fake-patient" and
 *     always ended in a 500. It now sends the saved template to the admin's
 *     own Telegram, says clearly why when it cannot, and writes no send row.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  template: null as null | Record<string, unknown>,
  user: null as null | Record<string, unknown>,
  clinic: null as null | Record<string, unknown>,
  sent: [] as Array<{ chatId: unknown; text: string; opts: Record<string, unknown> }>,
  sendError: null as null | Error,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/server/telegram/send", () => ({
  sendMessage: vi.fn(async (_clinic: unknown, chatId: unknown, text: string, opts: Record<string, unknown>) => {
    if (h.sendError) throw h.sendError;
    h.sent.push({ chatId, text, opts });
    return { message_id: 1, chat: { id: 1 }, date: 0 };
  }),
}));
vi.mock("@/lib/prisma", () => {
  // No notificationSend on purpose: a test send must not write one.
  const prisma = {
    notificationTemplate: {
      findUnique: vi.fn(async () => h.template),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data);
        return { id: "new", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updated.push(data);
        return { ...h.template, ...data };
      }),
      // Saving switches the slot's other active templates off (TG-22): none.
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    user: { findFirst: vi.fn(async () => h.user) },
    clinic: { findUnique: vi.fn(async () => h.clinic) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

import { POST as testSend } from "@/app/api/crm/notifications/templates/[id]/test-send/route";
import { POST as createTemplate } from "@/app/api/crm/notifications/templates/route";
import { PATCH as patchTemplate } from "@/app/api/crm/notifications/templates/[id]/route";
import { templateChannelRefusal } from "@/server/notifications/rules";
import {
  templateTestFailure,
  templateTestRefusal,
} from "@/server/notifications/template-test";
import { UpdateUserSchema } from "@/server/schemas/user";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

function req(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SAMPLE = {
  patient: { name: "Иван Иванов", firstName: "Иван", phone: "+998 90 123-45-67" },
  appointment: { date: "25 апреля 2026", time: "10:00", doctor: "Д-р Алиева", service: "Консультация", cabinet: "12" },
};

beforeEach(() => {
  h.template = {
    id: "tpl1",
    key: "appointment.reminder-24h",
    channel: "TG",
    isActive: true,
    bodyRu: "Здравствуйте, {{patient.firstName}}! Завтра в {{appointment.time}} приём в {{clinic.name}} <b>{{clinic.phone}}</b>.",
    bodyUz: "Salom, {{patient.firstName}}! {{clinic.name}}",
  };
  h.user = { telegramId: "123456789" };
  h.clinic = {
    id: "c1",
    slug: "neurofax",
    nameRu: "NeuroFax & Co",
    nameUz: "NeuroFax UZ",
    phone: "+998 71 200-00-00",
    addressRu: "Ташкент",
    tgBotToken: "v1:x:y:z",
    tgBotUsername: "neurofax_bot",
  };
  h.sent = [];
  h.sendError = null;
  h.created = [];
  h.updated = [];
});

const runTest = (body: unknown = { locale: "ru", sample: SAMPLE }) =>
  testSend(req("POST", "https://x/api/crm/notifications/templates/tpl1/test-send", body));

describe("POST /api/crm/notifications/templates/[id]/test-send", () => {
  it("sends the saved template to the admin's own Telegram, rendered like a real send", async () => {
    const res = await runTest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.chatId).toBe("123456789");
    expect(h.sent[0]!.opts).toMatchObject({ parse_mode: "HTML" });
    // Sample patient from the editor, the clinic's real name (escaped), the
    // template's own markup kept.
    expect(h.sent[0]!.text).toBe(
      "Здравствуйте, Иван! Завтра в 10:00 приём в NeuroFax &amp; Co <b>+998 71 200-00-00</b>.",
    );
  });

  it("uses the Uzbek text for an Uzbek admin", async () => {
    await runTest({ locale: "uz", sample: SAMPLE });
    expect(h.sent[0]!.text).toBe("Salom, Иван! NeuroFax UZ");
  });

  it("refuses without a bot instead of faking a delivery", async () => {
    h.clinic!.tgBotToken = null;
    const res = await runTest();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("bot_not_connected");
    expect(h.sent).toEqual([]);
  });

  it("refuses when the account has no Telegram id", async () => {
    h.user = { telegramId: null };
    const res = await runTest();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("no_staff_telegram");
  });

  it("refuses a channel the worker does not deliver", async () => {
    h.template!.channel = "EMAIL";
    const res = await runTest();
    expect(((await res.json()) as { reason: string }).reason).toBe("channel_not_supported");
    expect(h.sent).toEqual([]);
  });

  it("explains a Telegram refusal instead of a 500", async () => {
    h.sendError = new Error("Telegram sendMessage failed: 403 Forbidden: bot can't initiate conversation with a user");
    const res = await runTest();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("staff_not_started_bot");
  });

  it("404 for a template of no one", async () => {
    h.template = null;
    expect((await runTest()).status).toBe(404);
  });
});

describe("template-test helpers", () => {
  it("templateTestRefusal", () => {
    const ok = { channel: "TG", botConnected: true, staffTelegramId: "1" };
    expect(templateTestRefusal(ok)).toBeNull();
    expect(templateTestRefusal({ ...ok, channel: "EMAIL" })).toBe("channel_not_supported");
    expect(templateTestRefusal({ ...ok, botConnected: false })).toBe("bot_not_connected");
    expect(templateTestRefusal({ ...ok, staffTelegramId: "  " })).toBe("no_staff_telegram");
  });

  it("templateTestFailure", () => {
    expect(templateTestFailure("Telegram sendMessage failed: 403 Forbidden: bot was blocked by the user")).toEqual({
      status: 409,
      reason: "staff_blocked_bot",
    });
    expect(templateTestFailure("Telegram sendMessage outcome unknown: aborted")).toEqual({
      status: 502,
      reason: "tg_timeout",
    });
    expect(templateTestFailure("Telegram sendMessage failed: 400 Bad Request")).toEqual({
      status: 502,
      reason: "tg_error",
    });
  });
});

describe("no EMAIL templates while email is not delivered", () => {
  it("templateChannelRefusal", () => {
    expect(templateChannelRefusal({ channel: "TG", isActive: true }, null)).toBeNull();
    expect(templateChannelRefusal({ channel: "EMAIL", isActive: false }, null)).toBe("channel_not_supported");
    expect(templateChannelRefusal({ channel: "EMAIL", isActive: true }, { channel: "EMAIL" })).toBe(
      "channel_not_supported",
    );
    expect(templateChannelRefusal({ channel: "EMAIL", isActive: false }, { channel: "TG" })).toBe(
      "channel_not_supported",
    );
    // An old EMAIL template can still be edited while it stays off.
    expect(templateChannelRefusal({ channel: "EMAIL", isActive: false }, { channel: "EMAIL" })).toBeNull();
  });

  const base = {
    key: "custom.mail",
    nameRu: "Письмо",
    nameUz: "Xat",
    category: "REMINDER",
    bodyRu: "Текст",
    bodyUz: "Matn",
  };

  it("POST refuses an EMAIL template", async () => {
    const res = await createTemplate(
      req("POST", "https://x/api/crm/notifications/templates", { ...base, channel: "EMAIL" }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { reason: string }).reason).toBe("channel_not_supported");
    expect(h.created).toEqual([]);
  });

  it("PATCH refuses switching an old EMAIL template on, allows moving it to Telegram", async () => {
    h.template = { ...h.template, channel: "EMAIL", isActive: false };
    const on = await patchTemplate(
      req("PATCH", "https://x/api/crm/notifications/templates/tpl1", { isActive: true }),
    );
    expect(on.status).toBe(400);
    expect(h.updated).toEqual([]);
    const moved = await patchTemplate(
      req("PATCH", "https://x/api/crm/notifications/templates/tpl1", { channel: "TG", isActive: true }),
    );
    expect(moved.status).toBe(200);
  });

  it("the editor offers Telegram only and calls the new test endpoint", () => {
    const src = read("src/app/[locale]/crm/notifications/_components/template-editor.tsx");
    expect(src).not.toMatch(/<SelectItem value="EMAIL">Email<\/SelectItem>/);
    expect(src).toMatch(/<SelectItem value="EMAIL" disabled>/);
    expect(src).not.toMatch(/patientId: "dev-fake-patient"/);
    expect(src).not.toMatch(/fetch\("\/api\/crm\/notifications\/sends"/);
    expect(src).toMatch(/\/test-send`/);
  });
});

describe("staff Telegram id", () => {
  it("accepts the numeric id and refuses a @username", () => {
    expect(UpdateUserSchema.safeParse({ telegramId: "123456789" }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ telegramId: null }).success).toBe(true);
    expect(UpdateUserSchema.safeParse({ telegramId: "@joe" }).success).toBe(false);
  });
});
