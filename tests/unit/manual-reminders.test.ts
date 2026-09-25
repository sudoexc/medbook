import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit AP-02: «Напомнить всем» on the Appointments page asked for the retired
 * -120 band, created nothing, then enqueued the day's FUTURE cascade rows; the
 * worker did not check `scheduledFor`, so «через 3 часа в 16:00» went out at
 * 09:00 and the real 13:00 reminder was spent, while the toast said
 * «Поставлено в очередь: 12».
 *
 * Now the button creates exactly one manual-reminder row per appointment
 * (own MANUAL template, due now) and dispatches only those; cascade rows stay
 * QUEUED with their own `scheduledFor`.
 */

const NOW = new Date("2026-09-25T04:00:00.000Z"); // 09:00 Tashkent

type Appt = {
  id: string;
  clinicId: string;
  patientId: string;
  date: Date;
  time: string | null;
  endDate: Date;
  status: string;
  confirmedAt: Date | null;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    telegramId: string | null;
    preferredChannel: string;
    preferredLang: "RU" | "UZ";
    birthDate: Date | null;
  };
  doctor: { nameRu: string; nameUz: string };
  primaryService: null;
  cabinet: null;
  clinic: {
    id: string;
    nameRu: string;
    nameUz: string;
    phone: string | null;
    addressRu: string | null;
    timezone: string;
  };
};

const state = vi.hoisted(() => ({
  appts: [] as Appt[],
  apptWhere: null as null | Record<string, unknown>,
  existing: [] as Array<{ appointmentId: string }>,
  created: [] as Array<Record<string, unknown>>,
  template: {
    id: "tpl_manual",
    bodyRu: "{{patient.firstName}}, ждём вас {{appointment.date}} в {{appointment.time}}.",
    bodyUz: "{{patient.firstName}}, sizni {{appointment.time}} da kutamiz.",
    channel: "TG",
    isActive: true,
  },
  upserts: [] as Array<Record<string, unknown>>,
  noChannel: [] as Array<Record<string, unknown>>,
  sendMutations: 0,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async (p: Record<string, unknown>) => {
    state.noChannel.push(p);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationTemplate: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        state.upserts.push(args);
        return state.template;
      }),
    },
    appointment: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.apptWhere = where;
        const ids = (where.id as { in: string[] }).in;
        return state.appts.filter((a) => ids.includes(a.id));
      }),
    },
    notificationSend: {
      findMany: vi.fn(async () => state.existing),
      createManyAndReturn: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.created.push(...data);
        return data.map((_, i) => ({ id: `snd_${state.created.length - data.length + i + 1}` }));
      }),
      // Any write to other rows would be the old bug (touching the cascade).
      updateMany: vi.fn(async () => {
        state.sendMutations += 1;
        return { count: 0 };
      }),
    },
  },
}));

import { materializeManualReminders } from "@/server/notifications/triggers";
import { MANUAL_APPOINTMENT_REMINDER_KEY } from "@/server/notifications/default-templates";

function appt(id: string, overrides: Partial<Appt> = {}): Appt {
  const date = new Date("2026-09-25T11:00:00.000Z"); // 16:00 Tashkent
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    date,
    time: "16:00",
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
    },
    doctor: { nameRu: "Невролог", nameUz: "Nevrolog" },
    primaryService: null,
    cabinet: null,
    clinic: {
      id: "c1",
      nameRu: "NeuroFax",
      nameUz: "NeuroFax",
      phone: "+998712000000",
      addressRu: null,
      timezone: "Asia/Tashkent",
    },
    ...overrides,
  };
}

beforeEach(() => {
  state.appts = [];
  state.apptWhere = null;
  state.existing = [];
  state.created = [];
  state.upserts = [];
  state.noChannel = [];
  state.sendMutations = 0;
  state.template = { ...state.template, isActive: true };
});

describe("materializeManualReminders", () => {
  it("creates one manual reminder per appointment, due now, and returns only those ids", async () => {
    state.appts = [appt("a1"), appt("a2")];
    const res = await materializeManualReminders({
      clinicId: "c1",
      appointmentIds: ["a1", "a2"],
      now: NOW,
    });

    expect(res.reminded).toBe(2);
    // TG + in-app mirror per patient, all of the manual template, due now.
    expect(state.created).toHaveLength(4);
    for (const row of state.created) {
      expect(row.templateId).toBe("tpl_manual");
      expect(row.scheduledFor).toEqual(NOW);
      expect(row.status).toBe("QUEUED");
    }
    expect(state.created.map((r) => r.appointmentId)).toEqual(["a1", "a1", "a2", "a2"]);
    expect(res.sendIds).toEqual(["snd_1", "snd_2", "snd_3", "snd_4"]);
    // The cascade rows are not touched.
    expect(state.sendMutations).toBe(0);
  });

  it("uses its own template, created on first use without clobbering an admin's edits", async () => {
    state.appts = [appt("a1")];
    await materializeManualReminders({ clinicId: "c1", appointmentIds: ["a1"], now: NOW });
    const up = state.upserts[0] as {
      where: { clinicId_key: { clinicId: string; key: string } };
      create: { trigger: string; key: string };
      update: Record<string, unknown>;
    };
    expect(up.where.clinicId_key).toEqual({ clinicId: "c1", key: MANUAL_APPOINTMENT_REMINDER_KEY });
    expect(up.create.trigger).toBe("MANUAL");
    expect(up.update).toEqual({});
  });

  it("only upcoming, not-yet-arrived visits are eligible", async () => {
    await materializeManualReminders({ clinicId: "c1", appointmentIds: ["a1"], now: NOW });
    expect(state.apptWhere).toMatchObject({
      clinicId: "c1",
      status: { in: ["BOOKED", "CONFIRMED"] },
      date: { gt: NOW },
    });
  });

  it("a second click reminds nobody twice", async () => {
    state.appts = [appt("a1"), appt("a2")];
    state.existing = [{ appointmentId: "a1" }];
    const res = await materializeManualReminders({
      clinicId: "c1",
      appointmentIds: ["a1", "a2"],
      now: NOW,
    });
    expect(res.reminded).toBe(1);
    expect(res.skipped).toBe(1);
    expect(new Set(state.created.map((r) => r.appointmentId))).toEqual(new Set(["a2"]));
  });

  it("a patient without Telegram becomes a call task, not a silent success", async () => {
    state.appts = [
      appt("a1", {
        patient: { ...appt("a1").patient, telegramId: null },
      }),
    ];
    const res = await materializeManualReminders({
      clinicId: "c1",
      appointmentIds: ["a1"],
      now: NOW,
    });
    expect(res).toMatchObject({ reminded: 0, noChannel: 1, sendIds: [] });
    expect(state.noChannel[0]).toMatchObject({
      appointmentId: "a1",
      triggerKey: MANUAL_APPOINTMENT_REMINDER_KEY,
    });
  });

  it("speaks the patient's language", async () => {
    state.appts = [
      appt("a1", { patient: { ...appt("a1").patient, preferredLang: "UZ" } }),
    ];
    await materializeManualReminders({ clinicId: "c1", appointmentIds: ["a1"], now: NOW });
    expect(state.created[0]!.body).toBe("Каримова, sizni 16:00 da kutamiz.");
  });

  it("a template switched off by the clinic sends nothing and says so", async () => {
    state.template = { ...state.template, isActive: false };
    state.appts = [appt("a1")];
    const res = await materializeManualReminders({
      clinicId: "c1",
      appointmentIds: ["a1"],
      now: NOW,
    });
    expect(res.templateDisabled).toBe(true);
    expect(state.created).toHaveLength(0);
  });
});
