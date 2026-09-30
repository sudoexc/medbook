import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit G6-08: reminders and broadcasts went to the patient through the
 * notification worker, which only called Telegram. The patient answered
 * «Не смогу» or «А сколько стоит?» and the operator saw the answer without
 * what it answered. After Telegram accepts a notification, its text is
 * copied into the patient's dialog as the bot's message, marked «Рассылка»
 * or «Уведомление», once per delivery.
 */

type Conv = { id: string; clinicId: string; externalId: string | null; patientId: string | null };

const state = vi.hoisted(() => ({
  convs: [] as Conv[],
  messages: [] as Array<Record<string, unknown>>,
  convUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  upserts: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  sentBodies: [] as string[],
  send: null as null | Record<string, unknown>,
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
}));
vi.mock("@/components/atoms/date-text", () => ({ DateText: () => null }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_c: string, e: { type: string; payload: Record<string, unknown> }) => {
    state.events.push(e);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          state.convs.find((c) =>
            Object.entries(where).every(([k, v]) =>
              k === "channel" ? true : (c as Record<string, unknown>)[k] === v,
            ),
          ) ?? null
        );
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.convUpdates.push(args);
        return { count: 1 };
      }),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        state.upserts.push(create);
        return { id: "conv_new" };
      }),
    },
    message: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.messages.some((m) => m.notificationSendId === data.notificationSendId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { id: `m${state.messages.length + 1}`, ...data };
        state.messages.push(row);
        return { id: row.id };
      }),
    },
    notificationSend: {
      findUnique: vi.fn(async () => state.send),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.send) Object.assign(state.send, data);
        return { count: 1 };
      }),
      update: vi.fn(async () => state.send),
    },
  },
}));
vi.mock("@/server/notifications/adapters", () => ({
  resolveAdapters: vi.fn(async () => ({
    tg: {
      send: vi.fn(async (_chat: string, body: string) => {
        state.sentBodies.push(body);
        return { messageId: 9 };
      }),
    },
  })),
}));
vi.mock("@/server/notifications/rate-limit", () => ({
  getRateLimiter: () => ({ check: async () => true }),
}));
vi.mock("@/server/notifications/record-delivery", () => ({
  recordNotificationDelivery: vi.fn(async () => ({})),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => {}),
  getQueue: () => ({ registerWorker: vi.fn() }),
}));

import {
  mirrorNotificationToConversation,
  telegramHtmlToText,
} from "@/server/conversations/notification-mirror";
import { _deliverForTests } from "@/server/workers/notifications-send";
import { MessageBubble } from "@/app/[locale]/crm/telegram/_components/message-bubble";
import type { InboxMessage } from "@/app/[locale]/crm/telegram/_hooks/types";

const SENT_AT = new Date("2026-09-30T04:00:00.000Z");

function input(overrides: Partial<Parameters<typeof mirrorNotificationToConversation>[0]> = {}) {
  return {
    clinicId: "c1",
    sendId: "snd_1",
    patientId: "p1",
    chatId: "555",
    body: "<b>Азиз</b>, напоминаем: завтра в 10:00 &amp; не забудьте анализы",
    campaignId: null,
    sentAt: SENT_AT,
    ...overrides,
  };
}

beforeEach(() => {
  state.convs = [{ id: "conv_1", clinicId: "c1", externalId: "555", patientId: "p1" }];
  state.messages = [];
  state.convUpdates = [];
  state.upserts = [];
  state.events = [];
  state.sentBodies = [];
  state.send = null;
});

describe("reminders and broadcasts appear in the patient's dialog (audit G6-08)", () => {
  it("a reminder becomes the bot's message in the patient's thread, before his answer", async () => {
    const id = await mirrorNotificationToConversation(input());
    expect(id).toBe("m1");
    expect(state.messages[0]).toMatchObject({
      clinicId: "c1",
      conversationId: "conv_1",
      direction: "OUT",
      senderId: null,
      status: "SENT",
      origin: "notification",
      notificationSendId: "snd_1",
      body: "Азиз, напоминаем: завтра в 10:00 & не забудьте анализы",
      createdAt: SENT_AT,
    });
    // The thread's last line moves to it (never back over a newer reply).
    expect(state.convUpdates[0]).toMatchObject({
      where: { id: "conv_1" },
      data: {
        lastMessageAt: SENT_AT,
        lastMessageText: "Азиз, напоминаем: завтра в 10:00 & не забудьте анализы",
      },
    });
    // Neither unread nor «Неотвеченные» is touched.
    expect(JSON.stringify(state.convUpdates)).not.toMatch(/unreadCount|awaitingReplySince/);
    expect(state.events).toHaveLength(1);
  });

  it("a broadcast is marked as one and does not flood open inboxes with events", async () => {
    await mirrorNotificationToConversation(input({ campaignId: "camp_1" }));
    expect(state.messages[0]).toMatchObject({ origin: "broadcast" });
    expect(state.events).toEqual([]);
  });

  it("is copied once per delivery", async () => {
    await mirrorNotificationToConversation(input());
    expect(await mirrorNotificationToConversation(input())).toBeNull();
    expect(state.messages).toHaveLength(1);
  });

  it("a thread opened from the card adopts the chat; with none, one is created", async () => {
    state.convs = [{ id: "conv_card", clinicId: "c1", externalId: null, patientId: "p1" }];
    await mirrorNotificationToConversation(input());
    expect(state.messages[0]).toMatchObject({ conversationId: "conv_card" });
    expect(state.convUpdates[0]).toEqual({
      where: { id: "conv_card", externalId: null },
      data: { externalId: "555" },
    });

    state.convs = [];
    state.messages = [];
    await mirrorNotificationToConversation(input({ sendId: "snd_2" }));
    expect(state.upserts[0]).toMatchObject({
      clinicId: "c1",
      channel: "TG",
      externalId: "555",
      patientId: "p1",
    });
    expect(state.messages[0]).toMatchObject({ conversationId: "conv_new" });
  });

  it("the worker copies a delivered TG notification into the dialog", async () => {
    state.send = {
      id: "snd_9",
      clinicId: "c1",
      patientId: "p1",
      appointmentId: null,
      campaignId: "camp_1",
      channel: "TG",
      recipient: "555",
      body: "Скидка 20% на массаж до пятницы",
      scheduledFor: new Date(Date.now() - 1_000),
      status: "QUEUED",
      retryCount: 0,
      failedReason: null,
      patient: { id: "p1", phone: "+998", telegramId: "555" },
      template: null,
    };
    await _deliverForTests({ sendId: "snd_9" });
    expect(state.sentBodies).toEqual(["Скидка 20% на массаж до пятницы"]);
    expect(state.messages).toEqual([
      expect.objectContaining({
        conversationId: "conv_1",
        origin: "broadcast",
        notificationSendId: "snd_9",
        body: "Скидка 20% на массаж до пятницы",
      }),
    ]);
  });

  it("Telegram HTML reads as plain text", () => {
    expect(telegramHtmlToText("<b>Привет</b><br/>до встречи &lt;3 &#39;ok&#39; &#x41;")).toBe(
      "Привет\nдо встречи <3 'ok' A",
    );
  });
});

describe("the bubble names what the bot sent", () => {
  const message = (overrides: Partial<InboxMessage>): InboxMessage => ({
    id: "m1",
    conversationId: "c1",
    direction: "OUT",
    body: "Завтра в 10:00 ждём вас",
    attachments: null,
    buttons: null,
    senderId: null,
    sender: null,
    status: "SENT",
    externalId: null,
    replyToId: null,
    createdAt: "2026-09-30T04:00:00.000Z",
    ...overrides,
  });
  const html = (m: InboxMessage) =>
    renderToStaticMarkup(React.createElement(MessageBubble, { message: m, onRetry: () => {} }));

  it("«Уведомление» and «Рассылка» instead of «Бот»", () => {
    expect(html(message({ origin: "notification" }))).toContain("tgInbox.message.origin.notification");
    expect(html(message({ origin: "broadcast" }))).toContain("tgInbox.message.origin.broadcast");
    expect(html(message({ origin: null }))).toContain("tgInbox.mode.bot");
  });

  it("a queued staff message says it is being sent; a failed one offers «Повторить»", () => {
    const staff = { senderId: "u1", sender: { id: "u1", name: "Дилноза" } };
    expect(html(message({ ...staff, status: "QUEUED" }))).toContain("tgInbox.message.sending");
    expect(html(message({ ...staff, status: "SENDING" }))).toContain("tgInbox.message.sending");
    const failed = html(message({ ...staff, status: "FAILED", failedReason: "tg_timeout" }));
    expect(failed).toContain("tgInbox.message.retry");
    expect(failed).toContain("tgInbox.message.failed.tg_timeout");
    expect(html(message({ ...staff, status: "SENT" }))).not.toContain("tgInbox.message.sending");
    // The bot's copies are not the operator's to resend.
    expect(
      html(message({ origin: "notification", status: "FAILED" })),
    ).not.toContain("tgInbox.message.retry");
  });
});
