import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-02: a reminder whose offset an admin changed in «Настройки
 * уведомлений» (anything but the 5d/3d/1d/3h cascade) goes through the
 * scheduler's dynamic pass. That pass rendered with only the patient's name
 * and the date, always in Russian: «Иванов, напоминаем: завтра в  вы
 * записаны к  в . Если планы изменились, позвоните .». It looked only 72 h
 * ahead although the editor allows 7 days, so «за 4 дня» never fired. And a
 * patient without Telegram got a «позвонить» task on every tick, days before
 * the reminder was due.
 */

const NOW = new Date("2026-09-25T04:00:00.000Z"); // 09:00 Tashkent

type Tpl = {
  id: string;
  clinicId: string;
  channel: "TG";
  bodyRu: string;
  bodyUz: string;
  triggerConfig: Record<string, unknown>;
};

const state = vi.hoisted(() => ({
  templates: [] as Tpl[],
  appts: [] as Array<Record<string, unknown>>,
  apptWhere: null as null | { date: { gte: Date; lte: Date } },
  created: [] as Array<Record<string, unknown>>,
  noChannel: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationTemplate: {
      findMany: vi.fn(async () => state.templates),
    },
    appointment: {
      findMany: vi.fn(async ({ where }: { where: { date: { gte: Date; lte: Date } } }) => {
        state.apptWhere = where;
        return state.appts.filter((a) => {
          const d = (a.date as Date).getTime();
          return d >= where.date.gte.getTime() && d <= where.date.lte.getTime();
        });
      }),
    },
    notificationSend: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.created.push(...data);
        return { count: data.length };
      }),
    },
  },
}));

vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async (p: Record<string, unknown>) => {
    state.noChannel.push(p);
  }),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => undefined),
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }),
}));
vi.mock("@/server/workers/notifications-send", () => ({
  QUEUE_NAME: "notifications:send",
  JOB_NAME: "deliver",
}));

import { runDynamicReminders } from "@/server/workers/notifications-scheduler";

const BODY_RU =
  "{{patient.firstName}}, напоминаем: в {{appointment.time}} вы записаны к {{appointment.doctor}} ({{appointment.service}}) в {{clinic.name}}. Если планы изменились, позвоните {{clinic.phone}}.";
const BODY_UZ =
  "{{patient.firstName}}, eslatma: soat {{appointment.time}} da {{appointment.doctor}} ({{appointment.service}}), {{clinic.name}}. Telefon: {{clinic.phone}}.";

function tpl(offsetMin: number, extra: Record<string, unknown> = {}): Tpl {
  return {
    id: `tpl_${Math.abs(offsetMin)}`,
    clinicId: "c1",
    channel: "TG",
    bodyRu: BODY_RU,
    bodyUz: BODY_UZ,
    triggerConfig: { offsetMin, ...extra },
  };
}

function appt(
  id: string,
  date: Date,
  patient: Partial<{ telegramId: string | null; preferredLang: "RU" | "UZ" }> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    date,
    time: null,
    endDate: new Date(date.getTime() + 30 * 60_000),
    status: "BOOKED",
    confirmedAt: null,
    patient: {
      id: `p_${id}`,
      fullName: "Каримова Дилноза",
      phone: "+998901234567",
      telegramId: "tg_1",
      preferredChannel: "TG",
      preferredLang: "RU",
      birthDate: null,
      ...patient,
    },
    doctor: { nameRu: "Юсупов А.", nameUz: "Yusupov A." },
    primaryService: { nameRu: "Консультация невролога", nameUz: "Nevrolog konsultatsiyasi" },
    cabinet: { number: "12" },
    clinic: {
      id: "c1",
      nameRu: "НейроФакс",
      nameUz: "NeuroFax",
      phone: "+998712000000",
      addressRu: "Чиланзар, 5",
      timezone: "Asia/Tashkent",
    },
    ...overrides,
  };
}

const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

beforeEach(() => {
  state.templates = [];
  state.appts = [];
  state.apptWhere = null;
  state.created = [];
  state.noChannel = [];
});

describe("runDynamicReminders — custom offsets (audit TG-02)", () => {
  it("renders a -1200 reminder with time, doctor, service and clinic, in the patient's language", async () => {
    state.templates = [tpl(-1200)];
    // Tomorrow 06:00Z = 11:00 Tashkent: the 20h reminder is due at 15:00 today.
    const visit = new Date("2026-09-26T06:00:00.000Z");
    state.appts = [
      appt("ru", visit),
      appt("uz", visit, { preferredLang: "UZ", telegramId: "tg_2" }),
    ];

    await runDynamicReminders(hours(5)); // 14:00, the pass sees tomorrow's visit

    const tg = state.created.filter((r) => r.channel === "TG");
    const ru = tg.find((r) => r.appointmentId === "ru")!;
    const uz = tg.find((r) => r.appointmentId === "uz")!;
    expect(ru.body).toBe(
      "Каримова, напоминаем: в 11:00 вы записаны к Юсупов А. (Консультация невролога) в НейроФакс. Если планы изменились, позвоните +998712000000.",
    );
    expect(uz.body).toBe(
      "Каримова, eslatma: soat 11:00 da Yusupov A. (Nevrolog konsultatsiyasi), NeuroFax. Telefon: +998712000000.",
    );
    expect(ru.scheduledFor).toEqual(new Date(visit.getTime() - 1200 * 60_000));
    // The Mini App mirror carries the same text.
    expect(state.created.find((r) => r.channel === "INAPP" && r.appointmentId === "uz")!.body).toBe(
      uz.body,
    );
  });

  it("creates the «за 4 дня» (-5760) row, which a 72 h look-ahead never could", async () => {
    state.templates = [tpl(-5760)];
    const visit = hours(5 * 24);
    state.appts = [appt("far", visit)];

    // Four days and 30 minutes before the visit: the old pass looked 72 h
    // ahead, did not see it, and by the time it did the moment was past.
    await runDynamicReminders(new Date(visit.getTime() - (4 * 24 * 60 + 30) * 60_000));

    expect(state.apptWhere!.date.lte.getTime() - state.apptWhere!.date.gte.getTime())
      .toBeGreaterThan(4 * 24 * 3600_000);
    const row = state.created.find((r) => r.channel === "TG")!;
    expect(row).toBeDefined();
    expect(row.scheduledFor).toEqual(new Date(visit.getTime() - 5760 * 60_000));
    expect(row.body).toContain("в 09:00");
  });

  it("asks reception to call a patient without Telegram only once the reminder is due", async () => {
    state.templates = [tpl(-1200)];
    const visit = new Date(NOW.getTime() + (20 * 60 + 30) * 60_000);
    state.appts = [appt("notg", visit, { telegramId: null })];

    await runDynamicReminders(NOW); // due in 30 min: nothing to call about yet
    expect(state.noChannel).toEqual([]);
    expect(state.created).toEqual([]);

    await runDynamicReminders(new Date(NOW.getTime() + 30 * 60_000)); // due now
    expect(state.noChannel).toHaveLength(1);
    expect(state.noChannel[0]).toMatchObject({ appointmentId: "notg" });
  });

  it("does not build a reminder that asks to confirm for an already confirmed visit", async () => {
    state.templates = [tpl(-2880, { skipIfConfirmed: true }), tpl(-600)];
    state.appts = [
      appt("conf", hours(48.5), {}, { status: "CONFIRMED", confirmedAt: NOW }),
    ];

    await runDynamicReminders(NOW);

    const tg = state.created.filter((r) => r.channel === "TG");
    expect(tg.map((r) => r.templateId)).toEqual(["tpl_600"]);
  });
});

describe("onboarding playbooks (audit TG-02)", () => {
  it("never tell a patient to «reply YES» (nothing parses a text reply)", async () => {
    const { PLAYBOOKS } = await import("@/server/onboarding/playbooks");
    for (const pb of Object.values(PLAYBOOKS)) {
      for (const t of pb.templates) {
        expect(t.bodyRu).not.toMatch(/YES|ответьте/i);
        expect(t.bodyUz).not.toMatch(/YES|javob bering/i);
      }
    }
  });
});
