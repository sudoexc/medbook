/**
 * Audit MA-13: medication reminders after the first push.
 *
 * Nothing wrote SNOOZED back or EXPIRED: «Отложить на 30 минут» never
 * reminded again, unanswered rows piled up forever, the list endpoint
 * returned the 30 OLDEST open rows, and the home screen offered a week-old
 * dose as «Пора принять». The follow-up worker now expires doses past the
 * open window and re-sends snoozed ones on the same row; the list is the
 * last 24 hours, newest first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isMedicationReminderDue,
  isMedicationReminderExpired,
  isMedicationSnoozeElapsed,
  medicationReminderOpenSince,
  pickDueMedicationReminder,
} from "@/lib/patient-experience/medication-reminders";

type Row = {
  id: string;
  clinicId: string;
  patientId: string;
  status: string;
  scheduledFor: Date;
  snoozeUntil: Date | null;
  sentAt: Date | null;
  prescriptionStatus?: string;
};

const store = vi.hoisted(() => ({
  rows: [] as Row[],
  sends: [] as Array<Record<string, unknown>>,
  templates: [] as Array<Record<string, unknown>>,
  listArgs: null as Record<string, unknown> | null,
}));

type Where = Record<string, unknown>;
function matchRow(r: Row, where: Where): boolean {
  for (const [k, c] of Object.entries(where)) {
    const v = (r as Record<string, unknown>)[k];
    if (c !== null && typeof c === "object" && !(c instanceof Date)) {
      const cond = c as Record<string, unknown>;
      if ("in" in cond && !(cond.in as unknown[]).includes(v)) return false;
      if ("lt" in cond && !((v as Date) < (cond.lt as Date))) return false;
      if ("lte" in cond && !(v !== null && (v as Date) <= (cond.lte as Date))) return false;
      if ("gte" in cond && !((v as Date) >= (cond.gte as Date))) return false;
    } else if (v !== c) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    medicationReminderSend: {
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = store.rows.filter((r) => matchRow(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      findMany: vi.fn(async (args: { where: Where }) => {
        // The list endpoint passes clinic/patient + an OR; the worker a flat filter.
        if ("OR" in args.where) {
          store.listArgs = args as unknown as Record<string, unknown>;
          return [];
        }
        return store.rows
          .filter((r) => matchRow(r, args.where))
          .map((r) => ({
            ...r,
            prescription: {
              drugName: "Карбамазепин",
              dosage: "200 мг",
              status: r.prescriptionStatus ?? "ACTIVE",
              remindersEnabled: true,
              case: null,
            },
            patient: {
              fullName: "Каримова Дилноза",
              phone: "+998901234567",
              telegramId: "555123",
              marketingOptOut: false,
              deletedAt: null,
            },
            clinic: { nameRu: "NeuroFax", timezone: "Asia/Tashkent", medicationRemindersEnabled: true },
          }));
      }),
    },
    notificationTemplate: {
      findMany: vi.fn(async () => store.templates),
    },
    notificationSend: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.sends.push(data);
        return data;
      }),
    },
    clinic: {
      findUnique: vi.fn(async () => ({ timezone: "Asia/Tashkent", medicationRemindersEnabled: true })),
    },
    prescription: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/server/queue", () => ({ getQueue: () => ({}) }));
vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p1",
    patient: { id: "p1", fullName: "Dilnoza", preferredLang: "RU" },
  };
  const wrap =
    (_o: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({ request, body: undefined, ctx });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));

import { runMedicationReminderFollowUp } from "@/server/workers/medication-reminder-followup";
import { GET as listMedications } from "@/app/api/miniapp/medications/route";

const now = new Date("2026-10-01T10:00:00.000Z");
const hour = 60 * 60 * 1000;
const ago = (h: number) => new Date(now.getTime() - h * hour);

function row(id: string, status: string, scheduledHoursAgo: number, snoozeUntil: Date | null = null): Row {
  return {
    id,
    clinicId: "c1",
    patientId: "p1",
    status,
    scheduledFor: ago(scheduledHoursAgo),
    snoozeUntil,
    sentAt: ago(scheduledHoursAgo),
  };
}

beforeEach(() => {
  store.rows = [];
  store.sends = [];
  store.listArgs = null;
  store.templates = [
    { id: "tpl1", clinicId: "c1", bodyRu: "Пора принять {{drug.name}} ({{time}})", channel: "TG" },
  ];
});

describe("reminder lifecycle helpers", () => {
  it("expires unanswered doses past 24 hours, never answered ones", () => {
    expect(isMedicationReminderExpired({ status: "PENDING", scheduledFor: ago(25), snoozeUntil: null }, now)).toBe(true);
    expect(isMedicationReminderExpired({ status: "SNOOZED", scheduledFor: ago(25), snoozeUntil: ago(24) }, now)).toBe(true);
    expect(isMedicationReminderExpired({ status: "PENDING", scheduledFor: ago(23), snoozeUntil: null }, now)).toBe(false);
    expect(isMedicationReminderExpired({ status: "TAKEN", scheduledFor: ago(48), snoozeUntil: null }, now)).toBe(false);
  });

  it("a snooze is over once snoozeUntil has passed", () => {
    expect(isMedicationSnoozeElapsed({ status: "SNOOZED", scheduledFor: ago(1), snoozeUntil: ago(0.1) }, now)).toBe(true);
    expect(isMedicationSnoozeElapsed({ status: "SNOOZED", scheduledFor: ago(1), snoozeUntil: new Date(now.getTime() + 60_000) }, now)).toBe(false);
    expect(isMedicationReminderDue({ status: "SNOOZED", scheduledFor: ago(1), snoozeUntil: new Date(now.getTime() + 60_000) }, now)).toBe(false);
  });

  it("the home screen asks about the newest due dose, not the oldest", () => {
    const list = [
      { id: "week", status: "PENDING", scheduledFor: ago(24 * 7).toISOString(), snoozeUntil: null },
      { id: "morning", status: "PENDING", scheduledFor: ago(6).toISOString(), snoozeUntil: null },
      { id: "noon", status: "PENDING", scheduledFor: ago(1).toISOString(), snoozeUntil: null },
      { id: "taken", status: "TAKEN", scheduledFor: ago(0.5).toISOString(), snoozeUntil: null },
    ];
    expect(pickDueMedicationReminder(list, now)?.id).toBe("noon");
    expect(pickDueMedicationReminder([list[0]!], now)).toBeNull();
  });
});

describe("runMedicationReminderFollowUp", () => {
  it("marks PENDING and SNOOZED rows older than 24h EXPIRED and leaves answers alone", async () => {
    store.rows = [
      row("old_pending", "PENDING", 25),
      row("old_snoozed", "SNOOZED", 30, ago(29)),
      row("fresh", "PENDING", 2),
      row("old_taken", "TAKEN", 48),
    ];
    const out = await runMedicationReminderFollowUp(now);
    const by = Object.fromEntries(store.rows.map((r) => [r.id, r.status]));
    expect(by).toEqual({
      old_pending: "EXPIRED",
      old_snoozed: "EXPIRED",
      fresh: "PENDING",
      old_taken: "TAKEN",
    });
    expect(out.expired).toBe(2);
    expect(store.sends).toHaveLength(0);
  });

  it("re-sends a snoozed dose once snoozeUntil has passed, on the same row", async () => {
    store.rows = [
      row("snooze_over", "SNOOZED", 1, ago(0.1)),
      row("snooze_running", "SNOOZED", 1, new Date(now.getTime() + 20 * 60_000)),
    ];
    const out = await runMedicationReminderFollowUp(now);
    const over = store.rows.find((r) => r.id === "snooze_over")!;
    expect(over.status).toBe("PENDING");
    expect(over.snoozeUntil).toBeNull();
    expect(over.sentAt).toEqual(now);
    expect(store.rows.find((r) => r.id === "snooze_running")!.status).toBe("SNOOZED");
    expect(out).toMatchObject({ resurfaced: 1, pushed: 1 });
    // INAPP always, TG to the patient's chat; the dose's own clock time.
    expect(store.sends.map((s) => s.channel).sort()).toEqual(["INAPP", "TG"]);
    expect(store.sends.find((s) => s.channel === "TG")).toMatchObject({
      recipient: "555123",
      body: "Пора принять Карбамазепин (14:00)",
      scheduledFor: now,
    });
  });

  it("a second pass does not send again", async () => {
    store.rows = [row("snooze_over", "SNOOZED", 1, ago(0.1))];
    await runMedicationReminderFollowUp(now);
    await runMedicationReminderFollowUp(now);
    expect(store.sends).toHaveLength(2);
  });

  it("closes a snoozed dose of a course stopped meanwhile instead of reminding", async () => {
    store.rows = [{ ...row("stopped", "SNOOZED", 1, ago(0.1)), prescriptionStatus: "CANCELLED" }];
    await runMedicationReminderFollowUp(now);
    expect(store.rows[0]!.status).toBe("EXPIRED");
    expect(store.sends).toHaveLength(0);
  });

  it("without a template the dose still comes back for the Mini App", async () => {
    store.templates = [];
    store.rows = [row("snooze_over", "SNOOZED", 1, ago(0.1))];
    await runMedicationReminderFollowUp(now);
    expect(store.rows[0]!.status).toBe("PENDING");
    expect(store.sends).toHaveLength(0);
  });
});

describe("GET /api/miniapp/medications", () => {
  it("lists the last 24 hours only, newest first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await listMedications(new Request("http://x/api/miniapp/medications?clinicSlug=neurofax"));
    } finally {
      vi.useRealTimers();
    }
    const args = store.listArgs as { where: Record<string, unknown>; orderBy: unknown };
    expect(args.where.scheduledFor).toEqual({ gte: medicationReminderOpenSince(now) });
    expect(args.orderBy).toEqual({ scheduledFor: "desc" });
  });
});
