/**
 * Audit TG-12 review: a row interrupted mid-send stays SENDING until the
 * sweep returns it to the queue. The «already scheduled?» gates of the
 * cascade (bulk materialiser), of single-appointment triggers and of the
 * dynamic reminder pass counted only QUEUED / SENT / DELIVERED / READ, so the
 * next tick built a second row for the same reminder and the sweep then
 * re-sent the first one too: the patient got it twice or three times.
 * Every gate now counts SENDING as scheduled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  template: null as null | Record<string, unknown>,
  appts: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => undefined),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => undefined),
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }),
}));
vi.mock("@/server/workers/notifications-send", () => ({
  QUEUE_NAME: "notifications:send",
  JOB_NAME: "deliver",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationTemplate: {
      findFirst: vi.fn(async () => (state.template ? { ...state.template } : null)),
      findMany: vi.fn(async () => (state.template ? [{ ...state.template }] : [])),
      upsert: vi.fn(async () => ({ ...state.template })),
    },
    appointment: {
      findMany: vi.fn(async () => state.appts),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.appts.find((a) => a.id === where.id) ?? null,
      ),
    },
    notificationSend: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        state.sends.find((s) => matchesWhere(s, where)) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.sends.filter((s) => matchesWhere(s, where)),
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.created.push(data);
        return data;
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        state.created.push(...data);
        return { count: data.length };
      }),
    },
  },
}));

const NOW = new Date("2026-10-01T05:00:00.000Z"); // 10:00 Tashkent
const VISIT = new Date(NOW.getTime() + 24 * 3_600_000);

function appt(): Row {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    date: VISIT,
    time: "10:00",
    endDate: new Date(VISIT.getTime() + 30 * 60_000),
    status: "BOOKED",
    confirmedAt: null,
    patient: {
      id: "p1",
      fullName: "Каримов Азиз",
      phone: "+998901112233",
      telegramId: "tg_1",
      preferredChannel: "TG",
      preferredLang: "RU",
      birthDate: null,
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
  };
}

function inFlight(templateId: string, status = "SENDING"): Row {
  return {
    id: "snd_old",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    templateId,
    channel: "TG",
    status,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.template = null;
  state.appts = [appt()];
  state.sends = [];
  state.created = [];
});

describe("in-flight rows block re-materialisation (TG-12 review)", () => {
  it("cascade band: a SENDING row is not built a second time", async () => {
    const { materializeForAppointmentsBulk } = await import("@/server/notifications/triggers");
    state.template = {
      id: "tpl_24",
      clinicId: "c1",
      channel: "TG",
      bodyRu: "{{patient.firstName}}, ждём вас завтра в {{appointment.time}}",
      bodyUz: "x",
      triggerConfig: { offsetMin: -1440 },
    };
    state.sends.push(inFlight("tpl_24"));

    const res = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_1", scheduledFor: new Date(VISIT.getTime() - 1440 * 60_000) }],
      "appointment.reminder-24h",
    );

    expect(res).toEqual({ created: 0, skipped: 1 });
    expect(state.created).toEqual([]);
  });

  it("cascade band: still built when the earlier row FAILED or was CANCELLED", async () => {
    const { materializeForAppointmentsBulk } = await import("@/server/notifications/triggers");
    state.template = {
      id: "tpl_24",
      clinicId: "c1",
      channel: "TG",
      bodyRu: "{{patient.firstName}}, ждём вас",
      bodyUz: "x",
      triggerConfig: { offsetMin: -1440 },
    };
    state.sends.push(inFlight("tpl_24", "CANCELLED"));

    const res = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_1", scheduledFor: NOW }],
      "appointment.reminder-24h",
    );

    expect(res.created).toBeGreaterThan(0);
  });

  it("single-appointment trigger: a SENDING row reads as already scheduled", async () => {
    const { onPreVisitQuestionnaire } = await import("@/server/notifications/triggers");
    state.template = {
      id: "tpl_pv",
      clinicId: "c1",
      channel: "TG",
      bodyRu: "{{patient.firstName}}, заполните анкету",
      bodyUz: "x",
      triggerConfig: null,
    };
    state.sends.push(inFlight("tpl_pv"));

    const outcome = await onPreVisitQuestionnaire("apt_1");

    expect(outcome).toMatchObject({ created: 0, reason: "already_scheduled" });
    expect(state.created).toEqual([]);
  });

  it("dynamic reminder: a SENDING row inside the grace window is not built again", async () => {
    const { runDynamicReminders } = await import("@/server/workers/notifications-scheduler");
    state.template = {
      id: "tpl_20h",
      clinicId: "c1",
      channel: "TG",
      bodyRu: "{{patient.firstName}}, напоминаем",
      bodyUz: "x",
      triggerConfig: { offsetMin: -1200 },
    };
    // Due a minute ago, still inside the pass's grace window.
    state.appts = [{ ...appt(), date: new Date(NOW.getTime() + (1200 - 1) * 60_000) }];
    state.sends.push(inFlight("tpl_20h"));

    const res = await runDynamicReminders(NOW);

    expect(res.created).toBe(0);
    expect(state.created).toEqual([]);

    // Control: without the in-flight row the same pass does build it.
    state.sends = [];
    expect((await runDynamicReminders(NOW)).created).toBeGreaterThan(0);
  });
});
