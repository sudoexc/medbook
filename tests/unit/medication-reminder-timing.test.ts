/**
 * Audit INF-12: the medication tick ran once an hour at the minute of the
 * first deploy and only looked at the current local hour, so the 08:00 dose
 * went out at 08:37, and a tick that slipped from 08:59:58 to 09:00:01 never
 * reminded it at all. The worker now ticks every five minutes over a
 * trailing window: a dose goes out within one tick, a missed tick is caught
 * up, nothing hours old is sent.
 */
import { describe, expect, it, vi } from "vitest";

import {
  dosesDueBetween,
  parseSchedule,
} from "@/lib/patient-experience/medication-schedule";

const TZ = "Asia/Tashkent";
/** 2026-10-01 HH:MM:SS Tashkent (UTC+5). */
const at = (hms: string) => new Date(`2026-10-01T${hms}+05:00`);
const sched = (over: Record<string, unknown> = {}) =>
  parseSchedule(
    { times: ["08:00", "20:00"], startsAt: "2026-09-01T00:00:00.000Z", ...over },
    new Date("2026-09-01T00:00:00.000Z"),
  )!;
const MIN = 60_000;

describe("dosesDueBetween (INF-12)", () => {
  it("a 09:00:01 tick after a lost 08:xx tick still reminds the 08:00 dose", () => {
    const now = at("09:00:01");
    expect(dosesDueBetween(sched(), new Date(now.getTime() - 90 * MIN), now, TZ)).toEqual([
      at("08:00:00"),
    ]);
  });

  it("the first tick after 08:00 takes it, the next ones see nothing new for it", () => {
    const tick = (hms: string) => {
      const now = at(hms);
      return dosesDueBetween(sched(), new Date(now.getTime() - 5 * MIN), now, TZ);
    };
    expect(tick("07:58:00")).toEqual([]);
    expect(tick("08:03:00")).toEqual([at("08:00:00")]);
    expect(tick("08:08:00")).toEqual([]);
  });

  it("returns every dose of the window, a day boundary included", () => {
    const s = sched({ times: ["23:50", "00:10", "08:30"] });
    const now = new Date("2026-10-02T00:15:00+05:00");
    expect(dosesDueBetween(s, new Date(now.getTime() - 90 * MIN), now, TZ)).toEqual([
      new Date("2026-10-01T23:50:00+05:00"),
      new Date("2026-10-02T00:10:00+05:00"),
    ]);
  });

  it("not before the course starts, not after it ends", () => {
    const now = at("08:30:00");
    const from = new Date(now.getTime() - 90 * MIN);
    // Prescribed at 08:20: the 08:00 dose of that morning is not reminded.
    expect(dosesDueBetween(sched({ startsAt: "2026-10-01T03:20:00.000Z" }), from, now, TZ)).toEqual([]);
    // A one-day course from 30 September 00:00 Tashkent is over on 1 October.
    expect(
      dosesDueBetween(sched({ startsAt: "2026-09-29T19:00:00.000Z", days: 1 }), from, now, TZ),
    ).toEqual([]);
  });
});

// ── the worker ──────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  doses: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/notifications/ensure-template", () => ({
  ensureClinicTemplate: vi.fn(async () => ({
    id: "tpl_med",
    bodyRu: "в {{time}} пора принять {{drug.name}}",
    bodyUz: "soat {{time}} da {{drug.name}}",
    channel: "TG",
    isActive: true,
    triggerConfig: null,
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    prescription: {
      findMany: vi.fn(async () => [
        {
          id: "rx_1",
          clinicId: "c1",
          patientId: "p1",
          drugName: "Карбамазепин",
          dosage: "",
          schedule: { times: ["08:00", "20:00"], startsAt: "2026-09-01T00:00:00.000Z" },
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          patient: {
            fullName: "Каримов Азиз",
            phone: "+998",
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
        },
      ]),
    },
    medicationReminderSend: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const key = `${data.prescriptionId}|${(data.scheduledFor as Date).getTime()}`;
        if (state.doses.some((d) => d.key === key)) throw new Error("unique");
        const row = { id: `d${state.doses.length}`, key, ...data };
        state.doses.push(row);
        return row;
      }),
      update: vi.fn(async () => ({})),
    },
    notificationSend: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sends.push(data);
        return data;
      }),
    },
  },
}));
vi.mock("@/server/queue", () => ({ getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }) }));

describe("medication reminder tick (INF-12)", () => {
  it("reminds the dose on the first tick after it, catches a missed one up, never twice", async () => {
    const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");
    // The 08:00 tick was lost in a deploy; 09:00:01 still catches it up.
    expect((await runMedicationReminderTick(at("09:00:01"))).created).toBe(1);
    expect(state.doses[0]!.scheduledFor).toEqual(at("08:00:00"));
    expect(state.sends.find((s) => s.channel === "TG")!.scheduledFor).toEqual(at("08:00:00"));
    expect((await runMedicationReminderTick(at("09:05:01"))).created).toBe(0);
    // Hours later nothing stale goes out; the evening dose waits for 20:00.
    expect((await runMedicationReminderTick(at("15:00:00"))).created).toBe(0);
    expect((await runMedicationReminderTick(at("20:04:00"))).created).toBe(1);
  });
});
