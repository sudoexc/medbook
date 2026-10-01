/**
 * Audit TG-09 / TG-15: the pre-visit questionnaire, the visit rating and the
 * medication reminders had no template anywhere, so they never went out
 * while visits were stamped «уведомлено».
 *
 *   - a clinic with no hand-made template gets the default on first use and
 *     the patient gets TG + in-app rows; the visit is stamped only then;
 *   - a template switched off stays off and the visit stays unstamped;
 *   - phone bookings (CONFIRMED) get the questionnaire too;
 *   - the message carries the Mini App button of its screen;
 *   - two doses in one hour are two reminders; a switched-off medication
 *     template still leaves the in-app banner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
  appts: [] as Array<Record<string, unknown>>,
  apptWhere: null as null | Record<string, unknown>,
  stamped: [] as Array<{ id: string; data: Record<string, unknown> }>,
  prescriptions: [] as Array<Record<string, unknown>>,
  doses: [] as Array<Record<string, unknown>>,
  noChannel: 0,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));

vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => {
    state.noChannel += 1;
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async ({ where }: { where: Row }) => {
        state.apptWhere = where;
        return state.appts.filter((a) => matchesWhere(a, { status: where.status as Row }));
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.appts.find((a) => a.id === where.id) ?? null,
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        state.stamped.push({ id: where.id, data });
        return { count: 1 };
      }),
    },
    notificationTemplate: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const t = state.templates.find((x) => matchesWhere(x, where));
        return t ? { ...t } : null;
      }),
      upsert: vi.fn(
        async ({ where, create }: { where: { clinicId_key: { clinicId: string; key: string } }; create: Row }) => {
          const k = where.clinicId_key;
          let t = state.templates.find((x) => x.clinicId === k.clinicId && x.key === k.key);
          if (!t) {
            t = { id: `tpl_${k.key}`, ...create };
            state.templates.push(t);
          }
          return { ...t };
        },
      ),
    },
    notificationSend: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        state.sends.find((s) => matchesWhere(s, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.sends.push(data);
        return data;
      }),
    },
    prescription: {
      findMany: vi.fn(async () => state.prescriptions),
    },
    medicationReminderSend: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const dup = state.doses.find(
          (d) =>
            d.prescriptionId === data.prescriptionId &&
            (d.scheduledFor as Date).getTime() === (data.scheduledFor as Date).getTime(),
        );
        if (dup) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: `dose_${state.doses.length}`, ...data };
        state.doses.push(row);
        return row;
      }),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => undefined),
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }),
}));

const NOW = new Date("2026-10-01T05:30:00.000Z"); // 10:30 Tashkent

function appt(over: Row = {}): Row {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    date: new Date(NOW.getTime() + 24 * 3_600_000),
    time: "10:30",
    endDate: new Date(NOW.getTime() + 24.5 * 3_600_000),
    status: "CONFIRMED",
    confirmedAt: new Date(),
    completedAt: null,
    preVisitNotifiedAt: null,
    preVisitSubmittedAt: null,
    npsRequestedAt: null,
    patient: {
      id: "p1",
      fullName: "Каримов Азиз",
      phone: "+998901112233",
      telegramId: "tg_1",
      preferredChannel: "TG",
      preferredLang: "RU",
      birthDate: null,
      marketingOptOut: false,
      deletedAt: null,
    },
    doctor: { nameRu: "Султанов А.", nameUz: "Sultanov A." },
    primaryService: null,
    cabinet: null,
    clinic: {
      id: "c1",
      nameRu: "НейроФакс",
      nameUz: "NeuroFax",
      phone: "+998712000000",
      addressRu: null,
      timezone: "Asia/Tashkent",
    },
    ...over,
  };
}

beforeEach(() => {
  state.templates = [];
  state.sends = [];
  state.appts = [];
  state.apptWhere = null;
  state.stamped = [];
  state.prescriptions = [];
  state.doses = [];
  state.noChannel = 0;
});

describe("pre-visit questionnaire (TG-09)", () => {
  it("creates the default template, sends TG + in-app and only then stamps the visit", async () => {
    const { runPreVisitTick } = await import("@/server/workers/pre-visit-questionnaire");
    state.appts.push(appt());

    const res = await runPreVisitTick(NOW);

    expect(state.templates.map((t) => t.key)).toEqual(["appointment.pre-visit-questionnaire"]);
    expect(state.sends.map((s) => s.channel).sort()).toEqual(["INAPP", "TG"]);
    expect(state.sends[0]!.body).toContain("Каримов");
    expect(state.sends[0]!.body).toContain("НейроФакс");
    expect(res.notified).toBe(1);
    expect(state.stamped).toEqual([
      { id: "apt_1", data: { preVisitNotifiedAt: NOW } },
    ]);
  });

  it("reads phone bookings (CONFIRMED) and Telegram patients only", async () => {
    const { runPreVisitTick } = await import("@/server/workers/pre-visit-questionnaire");
    await runPreVisitTick(NOW);
    expect((state.apptWhere!.status as { in: string[] }).in).toContain("CONFIRMED");
    expect(state.apptWhere!.patient).toMatchObject({
      deletedAt: null,
      telegramId: { not: null },
      tgBlockedAt: null,
    });
  });

  it("does not stamp a visit when the clinic switched the template off", async () => {
    const { runPreVisitTick } = await import("@/server/workers/pre-visit-questionnaire");
    state.templates.push({
      id: "tpl_off",
      clinicId: "c1",
      key: "appointment.pre-visit-questionnaire",
      isActive: false,
      bodyRu: "x",
      bodyUz: "x",
      channel: "TG",
    });
    state.appts.push(appt());

    const res = await runPreVisitTick(NOW);

    expect(res.notified).toBe(0);
    expect(state.sends).toEqual([]);
    expect(state.stamped).toEqual([]);
    expect(state.templates[0]!.isActive).toBe(false);
  });

  it("treats CONFIRMED as eligible in the pure gate", async () => {
    const { isPreVisitEligible } = await import("@/lib/patient-experience/pre-visit");
    expect(
      isPreVisitEligible(
        {
          startsAt: new Date(NOW.getTime() + 24 * 3_600_000),
          status: "CONFIRMED",
          preVisitNotifiedAt: null,
          preVisitSubmittedAt: null,
          patientHasContact: true,
        },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("post-visit rating (TG-09)", () => {
  it("creates the template and stamps npsRequestedAt after the rows exist", async () => {
    const { runPostVisitNpsTick } = await import("@/server/workers/post-visit-nps");
    state.appts.push(
      appt({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - 4.5 * 3_600_000) }),
    );
    const res = await runPostVisitNpsTick(NOW);
    expect(state.templates.map((t) => t.key)).toEqual(["appointment.nps-request"]);
    expect(state.sends.map((s) => s.channel).sort()).toEqual(["INAPP", "TG"]);
    expect(res.requested).toBe(1);
    expect(state.stamped[0]!.data).toEqual({ npsRequestedAt: NOW });
    // A Mini App form is no reason for a reception call task.
    expect(state.noChannel).toBe(0);
  });
});

describe("Mini App button (TG-09)", () => {
  it("opens the questionnaire of the appointment, in the patient's language", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://neurofax.uz/";
    const { miniAppButtonFor } = await import("@/server/workers/notifications-send");
    expect(
      miniAppButtonFor({
        appointmentId: "apt_1",
        templateKey: "appointment.pre-visit-questionnaire",
        clinicSlug: "neurofax",
        lang: "UZ",
      }),
    ).toEqual({
      text: "📝 So'rovnomani to'ldirish",
      web_app: { url: "https://neurofax.uz/c/neurofax/my/pre-visit/apt_1" },
    });
    expect(
      miniAppButtonFor({
        appointmentId: "apt_1",
        templateKey: "appointment.reminder-24h",
        clinicSlug: "neurofax",
        lang: "RU",
      }),
    ).toBeNull();
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    expect(
      miniAppButtonFor({
        appointmentId: "apt_1",
        templateKey: "appointment.nps-request",
        clinicSlug: "neurofax",
        lang: "RU",
      }),
    ).toBeNull();
    if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prev;
  });
});

describe("medication reminders (TG-15)", () => {
  // 08:31 Tashkent: both the 08:00 and the 08:30 dose are due (the tick
  // reminds the doses of its trailing window, audit INF-12).
  const AT = new Date("2026-10-01T03:31:00.000Z");

  function rx(over: Row = {}): Row {
    return {
      id: "rx_1",
      clinicId: "c1",
      patientId: "p1",
      drugName: "Карбамазепин",
      dosage: "200 мг",
      schedule: { times: ["08:00", "08:30", "20:00"], startsAt: "2026-09-01T00:00:00.000Z" },
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      patient: {
        fullName: "Каримов Азиз",
        phone: "+998901112233",
        telegramId: "tg_1",
        tgBlockedAt: null,
        preferredChannel: "TG",
        preferredLang: "RU",
        marketingOptOut: false,
        deletedAt: null,
      },
      clinic: {
        id: "c1",
        nameRu: "НейроФакс",
        nameUz: "NeuroFax",
        timezone: "Asia/Tashkent",
        medicationRemindersEnabled: true,
      },
      ...over,
    };
  }

  it("creates the template on first use and sends TG + in-app for each dose of the hour", async () => {
    const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");
    state.prescriptions.push(rx());

    const res = await runMedicationReminderTick(AT);

    expect(state.templates.map((t) => t.key)).toEqual(["medication.reminder"]);
    expect(res.created).toBe(2);
    expect(state.doses).toHaveLength(2);
    expect(state.sends.filter((s) => s.channel === "TG")).toHaveLength(2);
    expect(state.sends.filter((s) => s.channel === "INAPP")).toHaveLength(2);
    expect(state.sends.map((s) => s.body)).toContain(
      "Каримов, в 08:30 пора принять Карбамазепин 200 мг. Отметить приём можно в приложении клиники.",
    );
  });

  it("is idempotent within the hour", async () => {
    const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");
    state.prescriptions.push(rx());
    await runMedicationReminderTick(AT);
    const again = await runMedicationReminderTick(new Date(AT.getTime() + 20 * 60_000));
    expect(again.created).toBe(0);
    expect(state.doses).toHaveLength(2);
  });

  it("keeps the in-app banner but no Telegram push when the template is switched off", async () => {
    const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");
    state.templates.push({
      id: "tpl_med",
      clinicId: "c1",
      key: "medication.reminder",
      isActive: false,
      channel: "TG",
      bodyRu: "{{patient.firstName}}: {{drug.name}} в {{time}}.",
      bodyUz: "",
      triggerConfig: null,
    });
    state.prescriptions.push(rx({ schedule: { times: ["08:00"] } }));
    await runMedicationReminderTick(AT);
    expect(state.sends.map((s) => s.channel)).toEqual(["INAPP"]);
  });

  it("writes in Uzbek for an Uzbek-speaking patient and drops the gap of an empty dosage", async () => {
    const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");
    state.prescriptions.push(
      rx({
        dosage: "",
        schedule: { times: ["08:00"] },
        patient: { ...(rx().patient as Row), preferredLang: "UZ" },
      }),
    );
    await runMedicationReminderTick(AT);
    expect(state.sends[0]!.body).toBe(
      "Каримов, soat 08:00 da Карбамазепин qabul qilish vaqti. Qabulni klinika ilovasida belgilashingiz mumkin.",
    );
  });

  it("returns every dose of the hour from the schedule helper", async () => {
    const { dosesDueInWindow, isPrescriptionDueInWindow } = await import(
      "@/lib/patient-experience/medication-schedule"
    );
    const sched = {
      times: ["08:30", "08:00", "20:00"],
      days: null,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(dosesDueInWindow(sched, AT, "Asia/Tashkent").map((d) => d.toISOString())).toEqual([
      "2026-10-01T03:00:00.000Z",
      "2026-10-01T03:30:00.000Z",
    ]);
    expect(isPrescriptionDueInWindow(sched, AT, "Asia/Tashkent")?.dueAt.toISOString()).toBe(
      "2026-10-01T03:00:00.000Z",
    );
  });
});
