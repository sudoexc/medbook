/**
 * P6 B1: the low-severity Telegram findings.
 *
 *   TG-26  no inline-button editor in the composer; the API takes only buttons
 *          Telegram accepts.
 *   TG-27  a manual notification send is ADMIN only and goes to the patient's
 *          own chat.
 *   TG-28  Redis under BullMQ never evicts keys.
 *   TG-29  every patient text greets by the given name, not the surname.
 *   TG-30  the composer's «Подтвердить запись» card is named for what it does.
 *   TG-31  the broadcast funnel shows no metric Telegram never reports.
 *   TG-32  a doctor opens only the threads of his caseload, by id too (the
 *          retry of a failed message included); an assignee is staff of the
 *          clinic.
 *   TG-34  confirming a reminder keeps its text.
 *   TG-36  one toast per patient message.
 *   TG-39  the bot mode does not claim the bot runs the conversation.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "ADMIN" as string,
  patient: null as null | { id: string; telegramId: string | null },
  created: [] as Array<Record<string, unknown>>,
  conv: null as null | Record<string, unknown>,
  convWheres: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  msgWrites: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
  const handler =
    (
      opts: { roles?: string[]; bodySchema?: Schema },
      fn: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      if (opts.roles && !opts.roles.includes(h.role)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const parsed =
        request.method === "GET" ? undefined : opts.bodySchema?.safeParse(await request.json());
      if (parsed && !parsed.success) {
        return Response.json({ error: "Validation" }, { status: 400 });
      }
      return fn({
        request,
        body: parsed?.data,
        ctx: { kind: "TENANT", clinicId: "clinic_A", userId: "u_me", role: h.role },
      });
    };
  return { createApiHandler: handler, createApiListHandler: handler };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/audit/patient-view", () => ({ notePatientView: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
        h.patient && where.id === h.patient.id && where.clinicId === "clinic_A"
          ? h.patient
          : null,
      ),
    },
    notificationSend: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data);
        return { id: "send_1", ...data };
      }),
    },
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_me" })) },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
        where.id === "u_staff" && where.clinicId === "clinic_A" ? { id: "u_staff" } : null,
      ),
    },
    conversation: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.convWheres.push(where);
        return h.conv ? { ...h.conv } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.convWheres.push(where);
        return [];
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data);
        return { count: 1 };
      }),
    },
    message: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
      // A colleague's message that never reached his patient.
      findFirst: vi.fn(async () => ({
        id: "msg_f",
        direction: "OUT",
        senderId: "u_colleague",
        origin: null,
        status: "FAILED",
        body: "Результаты МРТ готовы",
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.msgWrites.push(data);
        return { id: "msg_f", ...data };
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.msgWrites.push(data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => ({ id: "msg_f" })),
    },
  },
}));

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const ru = JSON.parse(read("src/messages/ru.json"));
const uz = JSON.parse(read("src/messages/uz.json"));

beforeEach(() => {
  h.role = "ADMIN";
  h.patient = { id: "p1", telegramId: "tg_p1" };
  h.created = [];
  h.conv = null;
  h.convWheres = [];
  h.updates = [];
  h.msgWrites = [];
});

const json = (url: string, method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("TG-26: inline buttons", () => {
  it("the composer has no button editor and sends no buttons", () => {
    const composer = read("src/app/[locale]/crm/telegram/_components/message-composer.tsx");
    expect(composer).not.toMatch(/InlineButtonsEditor/);
    expect(composer).not.toMatch(/callback_data: ""/);
    expect(composer).not.toMatch(/buttons:/);
    expect(ru.tgInbox.composer.inlineButtons).toBeUndefined();
    expect(uz.tgInbox.composer.inlineButtons).toBeUndefined();
  });

  it("the API refuses a button Telegram would refuse", async () => {
    const { SendMessageSchema } = await import("@/server/schemas/message");
    const ok = (buttons: unknown) =>
      SendMessageSchema.safeParse({ body: "Когда удобно?", buttons }).success;
    expect(ok([[{ text: "Утро", callback_data: "morning" }]])).toBe(true);
    expect(ok([[{ text: "Сайт", url: "https://neurofax.uz" }]])).toBe(true);
    expect(ok(undefined)).toBe(true);
    // No data: Telegram answers 400 and the message ends FAILED.
    expect(ok([[{ text: "Вечер", callback_data: "" }]])).toBe(false);
    expect(ok([[{ text: "Вечер" }]])).toBe(false);
    expect(ok([[{ text: "", callback_data: "evening" }]])).toBe(false);
    // 64 bytes is Telegram's limit, and Cyrillic is two bytes a letter.
    expect(ok([[{ text: "Вечер", callback_data: "в".repeat(32) }]])).toBe(true);
    expect(ok([[{ text: "Вечер", callback_data: "в".repeat(33) }]])).toBe(false);
    expect(ok("garbage")).toBe(false);
  });
});

describe("TG-27: manual notification send", () => {
  const send = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/crm/notifications/sends/route");
    return POST(
      json("https://crm.test/api/crm/notifications/sends", "POST", {
        patientId: "p1",
        channel: "TG",
        body: "Здравствуйте!",
        scheduledFor: "2026-10-02T09:00:00.000Z",
        ...body,
      }),
    );
  };

  it("the desk roles get 403", async () => {
    for (const role of ["CALL_OPERATOR", "RECEPTIONIST"]) {
      h.role = role;
      expect((await send({})).status).toBe(403);
    }
    expect(h.created).toHaveLength(0);
  });

  it("goes to the patient's own chat, never to one typed into the request", async () => {
    const mismatch = await send({ recipient: "tg_somebody_else" });
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ reason: "recipient_mismatch" });
    expect(h.created).toHaveLength(0);

    const res = await send({});
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ patientId: "p1", recipient: "tg_p1", status: "QUEUED" });
  });

  it("a card of another clinic or without Telegram is refused", async () => {
    expect((await send({ patientId: "p_other_clinic" })).status).toBe(404);
    h.patient = { id: "p1", telegramId: null };
    const res = await send({});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "no_telegram" });
  });
});

describe("TG-28: Redis keeps the BullMQ keys", () => {
  it("runs with noeviction", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/"--maxmemory-policy", "noeviction"/);
    expect(compose).not.toMatch(/"allkeys-lru"/);
  });
});

describe("TG-29: the given name", () => {
  it("is the second word of «Фамилия Имя Отчество», or the only one", async () => {
    const { givenNameOf } = await import("@/lib/patients/given-name");
    expect(givenNameOf("Каримов Алишер Бахтиёрович")).toBe("Алишер");
    expect(givenNameOf("Алишер")).toBe("Алишер");
    expect(givenNameOf("  ")).toBe("");
  });

  it("an appointment reminder greets Алишер, not Каримов", async () => {
    const { renderAppointmentBody } = await import("@/server/notifications/triggers");
    const appt = {
      date: new Date("2026-10-03T09:00:00.000Z"),
      time: "14:00",
      patient: { fullName: "Каримов Алишер Бахтиёрович", phone: "+998901112233", preferredLang: "RU" },
      doctor: { nameRu: "Султанов А.", nameUz: "Sultanov A." },
      primaryService: null,
      clinic: { timezone: "Asia/Tashkent", nameRu: "НейроФакс", nameUz: "NeuroFax", phone: null, addressRu: null, addressUz: null },
    };
    const text = renderAppointmentBody(
      { bodyRu: "{{patient.firstName}}, ждём вас в {{appointment.time}}", bodyUz: "" },
      appt as never,
    );
    expect(text).toBe("Алишер, ждём вас в 14:00");
  });

  it("no patient text takes the first word of the name any more", () => {
    for (const file of [
      "src/server/notifications/triggers.ts",
      "src/server/workers/medication-reminder.ts",
      "src/server/workers/medication-reminder-followup.ts",
      "src/server/revenue/reactivation.ts",
      "src/server/campaigns/launch.ts",
    ]) {
      const code = read(file);
      expect(code, file).toMatch(/givenNameOf\(/);
      expect(code, file).not.toMatch(/split\(\/\\s\+\/\)\[0\]/);
    }
  });
});

describe("TG-30: the confirm card says it inserts a text", () => {
  it("is named «Текст подтверждения»", () => {
    expect(ru.tgInbox.composer.quick.confirm).toBe("Текст подтверждения");
    expect(uz.tgInbox.composer.quick.confirm).toBe("Tasdiqlash matni");
  });
});

describe("TG-31: broadcast funnel", () => {
  it("shows no delivered or read count", () => {
    const history = read("src/app/[locale]/crm/telegram/_components/broadcast-history.tsx");
    expect(history).not.toMatch(/funnel\.delivered|funnel\.read/);
    expect(ru.tgInbox.broadcastHistory.funnel.delivered).toBeUndefined();
    expect(uz.tgInbox.broadcastHistory.funnel.read).toBeUndefined();
    expect(ru.tgInbox.broadcastHistory.funnel.sent).toBeTruthy();
  });
});

describe("TG-32: a doctor's threads", () => {
  const scope = [
    { appointment: { doctorId: "doc_me" } },
    { patient: { appointments: { some: { doctorId: "doc_me" } } } },
    { assignedToId: "u_me" },
  ];

  it("the access rule: the desk sees the clinic, a doctor his caseload", async () => {
    const { conversationAccess } = await import("@/server/conversations/access");
    expect(
      await conversationAccess({ kind: "TENANT", clinicId: "clinic_A", userId: "u_r", role: "RECEPTIONIST" }),
    ).toEqual({ where: { clinicId: "clinic_A" }, doctorId: null });
    expect(
      await conversationAccess({ kind: "TENANT", clinicId: "clinic_A", userId: "u_me", role: "DOCTOR" }),
    ).toEqual({ where: { clinicId: "clinic_A", AND: [{ OR: scope }] }, doctorId: "doc_me" });
    expect(await conversationAccess({ kind: "SYSTEM" })).toBeNull();
  });

  it("messages of a thread outside his caseload are 404, read or write", async () => {
    h.role = "DOCTOR";
    const { GET, POST } = await import("@/app/api/crm/conversations/[id]/messages/route");
    const url = "https://crm.test/api/crm/conversations/conv_x/messages";
    expect((await GET(new Request(url))).status).toBe(404);
    expect((await POST(json(url, "POST", { body: "Здравствуйте" }))).status).toBe(404);
    for (const where of h.convWheres) {
      expect(where).toMatchObject({ id: "conv_x", clinicId: "clinic_A", AND: [{ OR: scope }] });
    }
    expect(h.convWheres).toHaveLength(2);
  });

  it("nor resend a failed message in one, or read it back", async () => {
    h.role = "DOCTOR";
    const { prisma } = await import("@/lib/prisma");
    const { POST } = await import(
      "@/app/api/crm/conversations/[id]/messages/[messageId]/retry/route"
    );
    vi.mocked(prisma.message.findFirst).mockClear();
    const res = await POST(
      new Request("https://crm.test/api/crm/conversations/conv_x/messages/msg_f/retry", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
    expect(h.convWheres[0]).toMatchObject({
      id: "conv_x",
      clinicId: "clinic_A",
      AND: [{ OR: scope }],
    });
    // The thread is refused before its message is looked up or touched.
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(h.msgWrites).toHaveLength(0);
  });

  it("the desk still retries in any thread of the clinic", async () => {
    h.role = "RECEPTIONIST";
    h.conv = {
      id: "conv_1",
      channel: "TG",
      externalId: null,
      patientId: "p1",
      patient: { telegramId: "tg_p1" },
      clinic: { tgBotToken: null },
    };
    const { POST } = await import(
      "@/app/api/crm/conversations/[id]/messages/[messageId]/retry/route"
    );
    const res = await POST(
      new Request("https://crm.test/api/crm/conversations/conv_1/messages/msg_f/retry", {
        method: "POST",
      }),
    );
    // Past the guard: with no bot the reason comes back at once.
    expect(res.status).toBe(200);
    expect(h.convWheres[0]).toEqual({ id: "conv_1", clinicId: "clinic_A" });
    expect(h.msgWrites).toEqual([{ failedReason: "bot_not_connected" }]);
  });

  it("nor may he change one", async () => {
    h.role = "DOCTOR";
    const { PATCH } = await import("@/app/api/crm/conversations/[id]/route");
    const res = await PATCH(
      json("https://crm.test/api/crm/conversations/conv_x", "PATCH", { status: "CLOSED" }),
    );
    expect(res.status).toBe(404);
    expect(h.convWheres[0]).toMatchObject({ id: "conv_x", AND: [{ OR: scope }] });
    expect(h.updates).toHaveLength(0);
  });

  it("a colleague's doctorId in the list is read as his own", async () => {
    h.role = "DOCTOR";
    const { GET } = await import("@/app/api/crm/conversations/route");
    const res = await GET(
      new Request("https://crm.test/api/crm/conversations?doctorId=doc_colleague&limit=50"),
    );
    expect(res.status).toBe(200);
    const and = (h.convWheres[0] as { AND: Array<{ OR?: unknown }> }).AND;
    expect(and).toContainEqual({ OR: scope });
    expect(JSON.stringify(h.convWheres[0])).not.toContain("doc_colleague");
  });

  it("the desk still filters by a doctor's caseload", async () => {
    h.role = "RECEPTIONIST";
    const { GET } = await import("@/app/api/crm/conversations/route");
    await GET(new Request("https://crm.test/api/crm/conversations?doctorId=doc_colleague"));
    expect(JSON.stringify(h.convWheres[0])).toContain("doc_colleague");
  });

  it("an assignee from outside the clinic's staff is refused", async () => {
    h.role = "RECEPTIONIST";
    h.conv = { id: "conv_1", clinicId: "clinic_A", assignedToId: null, patientId: null };
    const { PATCH } = await import("@/app/api/crm/conversations/[id]/route");
    const url = "https://crm.test/api/crm/conversations/conv_1";
    const bad = await PATCH(json(url, "PATCH", { assignedToId: "u_other_clinic" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ reason: "assignee_not_in_clinic" });
    expect(h.updates).toHaveLength(0);

    const good = await PATCH(json(url, "PATCH", { assignedToId: "u_staff" }));
    expect(good.status).toBe(200);
    expect(h.updates).toEqual([{ assignedToId: "u_staff" }]);
  });
});

describe("TG-34: a confirmed reminder keeps its text", () => {
  const reminder = "Алишер, напоминаем: завтра в 14:30 приём у невролога, кабинет 12.";
  const keyboard = (text: string) => ({
    inline_keyboard: [[{ text, callback_data: "confirm:appt_1" }]],
  });

  it("adds the mark under the text and keeps its formatting", async () => {
    const { confirmedReminderEdit } = await import("@/server/telegram/confirmed-reminder");
    const entities = [{ type: "bold", offset: 0, length: 6 }];
    expect(confirmedReminderEdit({ text: reminder, entities }, "ru")).toEqual({
      text: `${reminder}\n\n✅ Подтверждено, спасибо!`,
      entities,
    });
  });

  it("speaks the language of the button the reader tapped", async () => {
    const { confirmButtonLang, confirmedReminderEdit } = await import(
      "@/server/telegram/confirmed-reminder"
    );
    const msg = { text: reminder, reply_markup: keyboard("✅ Tasdiqlayman") };
    expect(confirmButtonLang(msg, "ru")).toBe("uz");
    expect(confirmButtonLang({ reply_markup: keyboard("✅ Подтверждаю") }, "uz")).toBe("ru");
    expect(confirmButtonLang({ text: reminder }, "uz")).toBe("uz");
    expect(confirmedReminderEdit(msg, "uz")?.text).toBe(`${reminder}\n\n✅ Tasdiqlandi, rahmat!`);
  });

  it("nothing to keep or already marked: only the keyboard goes", async () => {
    const { confirmedReminderEdit } = await import("@/server/telegram/confirmed-reminder");
    expect(confirmedReminderEdit({}, "ru")).toBeNull();
    expect(confirmedReminderEdit(undefined, "ru")).toBeNull();
    expect(
      confirmedReminderEdit({ text: `${reminder}\n\n✅ Подтверждено, спасибо!` }, "ru"),
    ).toBeNull();
    expect(confirmedReminderEdit({ text: "a".repeat(4090) }, "ru")).toBeNull();
  });
});

describe("TG-36: one toast per patient message", () => {
  it("only tg.message.new alerts; the takeover echo is silent", async () => {
    const { isMessageAlert } = await import("@/app/[locale]/crm/telegram/_lib/inbox-alert");
    expect(isMessageAlert({ type: "tg.message.new" })).toBe(true);
    expect(isMessageAlert({ type: "tg.takeover.incoming" })).toBe(false);
    expect(isMessageAlert({ type: "tg.conversation.updated" })).toBe(false);
    const hook = read("src/app/[locale]/crm/telegram/_hooks/use-tg-inbox-alerts.ts");
    expect(hook).toMatch(/if \(!isMessageAlert\(event\)\) return;/);
    expect(hook).not.toMatch(/event\.type !== "tg\.takeover\.incoming"/);
  });
});

describe("TG-39: the bot mode is described honestly", () => {
  it("no text says the bot answers or runs the conversation", () => {
    for (const [locale, m] of [
      ["ru", ru],
      ["uz", uz],
    ] as const) {
      const mode = m.tgInbox.mode as Record<string, string>;
      const all = Object.values(mode).join(" | ");
      expect(all, locale).not.toMatch(/Бот отвечает|ведёт переписку|Bot javob beradi|o'zi yozishmoqda/);
      expect(mode.botHint, locale).not.toMatch(/[—–]/);
    }
    expect(ru.tgInbox.mode.botHint).toMatch(/отвечаете вы/);
  });
});
