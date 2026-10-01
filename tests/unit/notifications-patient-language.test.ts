/**
 * Audit INF-11: what the workers write to a patient themselves (the «✅
 * Подтверждаю» button, the Mini App buttons, the DSAR archive messages) was
 * Russian for everyone, so a patient who reads Uzbek could not tell what to
 * tap and the visit stayed unconfirmed. The words now live in the message
 * files and follow the reader's `preferredLang`; a reminder relayed to a
 * family owner (P1D-01) follows the owner's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { patientTexts } from "@/server/notifications/patient-texts";

const state = vi.hoisted(() => ({
  send: null as null | Record<string, unknown>,
  appt: { status: "BOOKED", confirmedAt: null as Date | null, date: new Date() },
  readers: [] as Array<{ telegramId: string; preferredLang: "RU" | "UZ" }>,
  sent: [] as Array<{ chat: string; body: string; opts: { replyMarkup?: { inline_keyboard: Array<Array<{ text: string }>> } } }>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationSend: {
      findUnique: vi.fn(async () => state.send),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.send) Object.assign(state.send, data);
        return { count: 1 };
      }),
    },
    appointment: { findUnique: vi.fn(async () => state.appt) },
    patient: {
      findFirst: vi.fn(async ({ where }: { where: { telegramId: string } }) =>
        state.readers.find((r) => r.telegramId === where.telegramId) ?? null,
      ),
    },
  },
}));
vi.mock("@/server/notifications/adapters", () => ({
  resolveAdapters: vi.fn(async () => ({
    tg: {
      send: vi.fn(async (chat: string, body: string, opts: never) => {
        state.sent.push({ chat, body, opts });
        return { messageId: 1 };
      }),
    },
    inapp: { send: vi.fn(async () => ({ inboxId: "i1" })) },
  })),
}));
vi.mock("@/server/notifications/rate-limit", () => ({
  getRateLimiter: () => ({ check: async () => true }),
}));
vi.mock("@/server/notifications/record-delivery", () => ({
  recordNotificationDelivery: vi.fn(async () => undefined),
}));
vi.mock("@/server/conversations/notification-mirror", () => ({
  mirrorNotificationToConversation: vi.fn(async () => null),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => {}),
  getQueue: () => ({ registerWorker: vi.fn() }),
}));

function reminder(over: Record<string, unknown> = {}): Record<string, unknown> {
  const start = state.appt.date;
  return {
    id: "snd_1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    appointmentAt: start,
    campaignId: null,
    channel: "TG",
    recipient: "tg_p1",
    body: "Завтра в 10:00",
    scheduledFor: new Date(start.getTime() - 1440 * 60_000),
    status: "QUEUED",
    retryCount: 0,
    patient: { id: "p1", phone: "+998", telegramId: "tg_p1", preferredLang: "UZ" },
    template: { key: "reminder.24h", trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -1440 } },
    clinic: { slug: "nf" },
    ...over,
  };
}

beforeEach(() => {
  const start = new Date(Date.now() + 1440 * 60_000 - 1000);
  state.appt = { status: "BOOKED", confirmedAt: null, date: start };
  state.readers = [];
  state.sent = [];
});

const buttonText = () => state.sent[0]?.opts?.replyMarkup?.inline_keyboard[0]?.[0]?.text;

describe("the confirm button (INF-11)", () => {
  it("is in Uzbek for a patient who reads Uzbek, in Russian otherwise", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.send = reminder();
    await _deliverForTests({ sendId: "snd_1" });
    expect(buttonText()).toBe("✅ Tasdiqlayman");

    state.sent = [];
    state.send = reminder({ patient: { id: "p1", phone: "+998", telegramId: "tg_p1", preferredLang: "RU" } });
    await _deliverForTests({ sendId: "snd_1" });
    expect(buttonText()).toBe("✅ Подтверждаю");
  });

  it("speaks the family owner's language on a relayed reminder (P1D-01)", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.readers = [{ telegramId: "tg_mom", preferredLang: "RU" }];
    state.send = reminder({
      recipient: "tg_mom",
      patient: { id: "child", phone: "+998", telegramId: null, preferredLang: "UZ" },
    });
    await _deliverForTests({ sendId: "snd_1" });
    expect(state.sent[0]?.chat).toBe("tg_mom");
    expect(buttonText()).toBe("✅ Подтверждаю");
  });
});

describe("worker texts (INF-11)", () => {
  it("exist in both languages", () => {
    for (const key of [
      "confirmButton",
      "questionnaireButton",
      "npsButton",
      "familyRelay",
      "dsarArchiveCaption",
      "dsarPassword",
    ] as const) {
      const r = patientTexts("RU")(key, { name: "A", passphrase: "p" });
      const u = patientTexts("UZ")(key, { name: "A", passphrase: "p" });
      expect(r, key).toBeTruthy();
      expect(u, key).toBeTruthy();
      expect(r, key).not.toBe(u);
    }
    expect(patientTexts("UZ")("dsarPassword", { passphrase: "<code>abc</code>" })).toContain(
      "<code>abc</code>",
    );
  });

  it("no worker that writes to patients keeps a Russian literal in its code", () => {
    const root = path.resolve(__dirname, "../..");
    for (const file of [
      "src/server/workers/notifications-send.ts",
      "src/server/workers/data-export.ts",
      "src/server/workers/medication-reminder.ts",
      "src/server/notifications/family-relay.ts",
    ]) {
      const code = readFileSync(path.join(root, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "");
      const line = code.split("\n").find((l) => /[А-Яа-яЁё]/.test(l));
      expect(line, file).toBeUndefined();
    }
  });
});
