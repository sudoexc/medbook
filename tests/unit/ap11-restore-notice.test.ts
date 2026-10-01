/**
 * Audit AP-11 — after the doctor undoes a cancellation or a no-show, the
 * patient is told the visit is back and his reminders are rebuilt
 * (`onAppointmentRestored`, fired by the revert as `appointment.restored`).
 *
 * Pinned:
 *   1. The clinic's «запись восстановлена» row is created switched off (patient
 *      Telegram messages are turned on one by one); while off, nothing is sent
 *      but the reminder cascade still comes back.
 *   2. Switched on, a visit still ahead gets the notice and new QUEUED
 *      reminders; a visit already under way gets no notice.
 *   3. A visit dropped again meanwhile gets neither.
 *   4. The default text carries the template placeholders, no dashes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Template = {
  id: string;
  clinicId: string;
  key: string;
  trigger: string;
  triggerConfig: Record<string, unknown> | null;
  bodyRu: string;
  bodyUz: string;
  channel: string;
  isActive: boolean;
};
type Send = Record<string, unknown> & {
  id: string;
  templateId: string;
  status: string;
  channel: string;
};

const NOW = new Date("2026-10-01T06:00:00.000Z");

const state = vi.hoisted(() => ({
  templates: [] as Array<Record<string, unknown>>,
  sends: [] as Array<Record<string, unknown>>,
  apptDate: new Date(0),
  apptStatus: "BOOKED",
  seq: 0,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async () => ({
        id: "apt_1",
        clinicId: "c1",
        patientId: "p1",
        date: state.apptDate,
        endDate: new Date(state.apptDate.getTime() + 30 * 60_000),
        time: null,
        status: state.apptStatus,
        confirmedAt: null,
        patient: {
          id: "p1",
          fullName: "Каримова Дилноза",
          phone: "+998901234567",
          telegramId: "tg_1",
          preferredChannel: "TG",
          preferredLang: "RU",
          birthDate: null,
        },
        doctor: { nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz" },
        primaryService: null,
        cabinet: null,
        clinic: {
          id: "c1",
          nameRu: "НейроФакс",
          nameUz: "NeuroFax",
          phone: "+998711111111",
          addressRu: "Ташкент",
          timezone: "Asia/Tashkent",
        },
      })),
    },
    notificationTemplate: {
      upsert: vi.fn(
        async ({ create }: { create: Record<string, unknown> }) => {
          const found = state.templates.find((t) => t.key === create.key);
          if (found) return found;
          const row = { id: `tpl_${String(create.key)}`, ...create };
          state.templates.push(row);
          return row;
        },
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const branches = (where.OR as Record<string, unknown>[]) ?? [where];
        for (const b of branches) {
          const hit = (state.templates as Template[]).find((t) => {
            if (!t.isActive) return false;
            if (b.key !== undefined && t.key !== b.key) return false;
            if (b.trigger !== undefined && t.trigger !== b.trigger) return false;
            const cfg = b.triggerConfig as { path?: string[]; equals?: unknown } | undefined;
            if (cfg?.path?.[0] === "offsetMin") {
              const off = (t.triggerConfig as { offsetMin?: number } | null)?.offsetMin;
              if (off !== cfg.equals) return false;
            }
            return true;
          });
          if (hit) return hit;
        }
        return null;
      }),
    },
    notificationSend: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const statuses = (where.status as { in?: string[] } | undefined)?.in;
        return (
          (state.sends as Send[]).find(
            (s) =>
              s.templateId === where.templateId &&
              (!statuses || statuses.includes(s.status)),
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.seq += 1;
        const row = { ...data, id: `snd_${state.seq}` };
        state.sends.push(row);
        return row;
      }),
      // The cascade top-up first retracts reminders queued for another
      // start (TG-18); nothing here was queued for an older time.
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import { onAppointmentRestored } from "@/server/notifications/triggers";
import {
  APPOINTMENT_RESTORED_KEY,
  restoreNoticeTemplate,
} from "@/server/appointments/restore-notice";

const REMINDER_24H: Template = {
  id: "tpl_24h",
  clinicId: "c1",
  key: "appointment.reminder-24h",
  trigger: "APPOINTMENT_BEFORE",
  triggerConfig: { offsetMin: -1440 },
  bodyRu: "Завтра в {{appointment.time}}.",
  bodyUz: "Ertaga {{appointment.time}}.",
  channel: "TG",
  isActive: true,
};

beforeEach(() => {
  state.templates = [{ ...REMINDER_24H }];
  state.sends = [];
  state.apptDate = new Date(NOW.getTime() + 3 * 24 * 60 * 60_000);
  state.apptStatus = "BOOKED";
  state.seq = 0;
  vi.setSystemTime(NOW);
});

const restoredSends = () =>
  (state.sends as Send[]).filter((s) => s.templateId === `tpl_${APPOINTMENT_RESTORED_KEY}`);
const reminderSends = () => (state.sends as Send[]).filter((s) => s.templateId === "tpl_24h");

describe("AP-11: the restored visit's messages", () => {
  it("provisions the notice switched off: no notice yet, reminders rebuilt", async () => {
    await onAppointmentRestored("apt_1", NOW);
    const row = state.templates.find((t) => t.key === APPOINTMENT_RESTORED_KEY);
    expect(row).toMatchObject({ isActive: false, trigger: "MANUAL" });
    expect(restoredSends()).toHaveLength(0);
    expect(reminderSends().map((s) => s.status)).toEqual(["QUEUED", "QUEUED"]);
  });

  it("switched on: the notice goes out now, with the reminders", async () => {
    state.templates.push({
      ...restoreNoticeTemplate(),
      id: `tpl_${APPOINTMENT_RESTORED_KEY}`,
      clinicId: "c1",
      isActive: true,
    });
    await onAppointmentRestored("apt_1", NOW);
    const notice = restoredSends();
    // The Telegram message and its in-app mirror.
    expect(notice.map((s) => s.channel).sort()).toEqual(["INAPP", "TG"]);
    expect(String(notice[0]!.body)).toContain("Султанов Азиз");
    expect(notice[0]!.status).toBe("QUEUED");
    expect(reminderSends().length).toBeGreaterThan(0);
  });

  it("no notice for a visit already under way (the late patient is here)", async () => {
    state.templates.push({
      ...restoreNoticeTemplate(),
      id: `tpl_${APPOINTMENT_RESTORED_KEY}`,
      clinicId: "c1",
      isActive: true,
    });
    state.apptDate = new Date(NOW.getTime() - 20 * 60_000);
    await onAppointmentRestored("apt_1", NOW);
    expect(restoredSends()).toHaveLength(0);
  });

  it("a visit dropped again meanwhile gets nothing", async () => {
    state.apptStatus = "CANCELLED";
    await onAppointmentRestored("apt_1", NOW);
    expect(state.sends).toHaveLength(0);
  });
});

describe("AP-11: the default text", () => {
  it("names the patient, the date, the time and the doctor through placeholders", () => {
    const tpl = restoreNoticeTemplate();
    for (const body of [tpl.bodyRu, tpl.bodyUz]) {
      expect(body).toContain("{{patient.firstName}}");
      expect(body).toContain("{{appointment.date}}");
      expect(body).toContain("{{appointment.time}}");
      expect(body).toContain("{{appointment.doctor}}");
      expect(body).not.toMatch(/[—–]/);
      expect(body).not.toMatch(/\{(name|date|time|doctor)\}/);
    }
    expect(tpl).toMatchObject({
      key: "appointment.restored",
      category: "TRANSACTIONAL",
      trigger: "MANUAL",
      channel: "TG",
    });
  });
});
