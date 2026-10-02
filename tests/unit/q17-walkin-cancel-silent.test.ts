/**
 * Audit Q-17 — the doctor's «Убрать из очереди» is a CANCELLED write on a
 * walk-in, and the generic cancellation trigger then told a patient still
 * sitting in the corridor «ваша запись отменена» (with no Telegram, it raised
 * a «позвонить» task per removed duplicate). A walk-in was never announced
 * as a booking, so its cancellation sends nothing and asks for no call.
 * Bookings keep their cancellation message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  channel: "WALKIN",
  telegramId: "tg_1" as string | null,
  sends: [] as Array<Record<string, unknown>>,
  templateLookups: 0,
  noChannel: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: state.noChannel,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async () => ({
        id: "apt_1",
        clinicId: "c1",
        patientId: "p1",
        date: new Date("2026-10-02T06:00:00.000Z"),
        endDate: new Date("2026-10-02T06:30:00.000Z"),
        time: "11:00",
        status: "CANCELLED",
        channel: state.channel,
        confirmedAt: new Date("2026-10-02T05:00:00.000Z"),
        patient: {
          id: "p1",
          fullName: "Каримова Дилноза",
          phone: "+998901234567",
          telegramId: state.telegramId,
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
          phone: null,
          addressRu: null,
          timezone: "Asia/Tashkent",
        },
      })),
    },
    notificationTemplate: {
      findFirst: vi.fn(async () => {
        state.templateLookups += 1;
        return {
          id: "tpl_cancel",
          key: "appointment.cancelled",
          nameRu: "Отмена",
          nameUz: "Bekor",
          bodyRu: "Ваша запись отменена.",
          bodyUz: "Yozuvingiz bekor qilindi.",
          channel: "TG",
          triggerConfig: {},
        };
      }),
    },
    notificationSend: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sends.push(data);
        return { id: `snd_${state.sends.length}`, ...data };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    patientFamily: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}));

import {
  isSilentForWalkin,
  onAppointmentCancelled,
} from "@/server/notifications/triggers";

beforeEach(() => {
  state.channel = "WALKIN";
  state.telegramId = "tg_1";
  state.sends = [];
  state.templateLookups = 0;
  state.noChannel.mockClear();
});

describe("Q-17 — removing a walk-in from the queue is silent", () => {
  it("every cancellation variant of a WALKIN row is silent, nothing else is", () => {
    for (const trigger of [
      "appointment.cancelled",
      "appointment.cancelled.by-staff",
      "appointment.cancelled.by-patient",
    ] as const) {
      expect(isSilentForWalkin(trigger, { channel: "WALKIN" })).toBe(true);
      expect(isSilentForWalkin(trigger, { channel: "PHONE" })).toBe(false);
    }
    expect(isSilentForWalkin("appointment.no-show", { channel: "WALKIN" })).toBe(false);
    expect(isSilentForWalkin("appointment.cancelled", {})).toBe(false);
  });

  it("a walk-in patient with Telegram gets no «запись отменена»", async () => {
    await onAppointmentCancelled("apt_1", "generic");
    await onAppointmentCancelled("apt_1", "by-staff");
    expect(state.sends).toEqual([]);
    expect(state.templateLookups).toBe(0);
  });

  it("a walk-in patient without Telegram raises no «позвонить» task", async () => {
    state.telegramId = null;
    await onAppointmentCancelled("apt_1", "generic");
    expect(state.noChannel).not.toHaveBeenCalled();
    expect(state.sends).toEqual([]);
  });

  it("a cancelled booking still tells the patient", async () => {
    state.channel = "PHONE";
    await onAppointmentCancelled("apt_1", "generic");
    expect(state.sends.some((s) => s.channel === "TG")).toBe(true);
    expect(String(state.sends[0]!.body)).toContain("отменена");
  });
});
