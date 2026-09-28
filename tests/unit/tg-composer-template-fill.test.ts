/**
 * Audit G6-04 — the composer's «Шаблоны» pasted a notification template as
 * is: the patient got «{{patient.firstName}}, напоминаем: завтра в
 * {{appointment.time}}...», in the operator's interface language.
 *
 * Templates are now filled on the server from the thread's card, the visit
 * the template is about and the clinic, in the patient's language. A field
 * with no data refuses the template with a reason; nothing with braces or a
 * hole is ever inserted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conv: { patientId: "p1" as string | null } as { patientId: string | null } | null,
  template: null as null | { bodyRu: string; bodyUz: string; trigger: string },
  clinic: {
    nameRu: "Нейрофакс",
    nameUz: "Neurofax",
    phone: "+998712000000" as string | null,
    addressRu: "ул. Мирабад, 1" as string | null,
    addressUz: "Mirobod ko'chasi, 1" as string | null,
  },
  patient: {
    id: "p1",
    fullName: "Каримова Дилноза Алишеровна",
    phone: "+998901234567",
    preferredLang: "UZ" as string | null,
  } as null | { id: string; fullName: string; phone: string; preferredLang: string | null },
  appointments: [] as Array<{ where: Record<string, unknown>; orderBy: unknown }>,
  visit: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst: vi.fn(async () => state.conv) },
    notificationTemplate: { findFirst: vi.fn(async () => state.template) },
    clinic: { findUnique: vi.fn(async () => state.clinic) },
    patient: { findFirst: vi.fn(async () => state.patient) },
    appointment: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown>; orderBy: unknown }) => {
        state.appointments.push(args);
        return state.visit;
      }),
    },
  },
}));

import {
  fillTemplate,
  fillTemplateForConversation,
  givenNameOf,
  visitPickFor,
} from "@/server/conversations/template-fill";
import { renderPlainWithReport } from "@/server/notifications/template";
import { DEFAULT_APPOINTMENT_TEMPLATES } from "@/server/notifications/default-templates";

const REMINDER_24H = DEFAULT_APPOINTMENT_TEMPLATES.find(
  (t) => t.key === "appointment.reminder-24h",
)!;

// 2026-10-07 10:30 in Tashkent.
const VISIT = {
  date: new Date("2026-10-07T05:30:00.000Z"),
  time: "10:30",
  doctor: { nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz" },
  primaryService: { nameRu: "Консультация невролога", nameUz: "Nevrolog maslahati" },
  cabinet: { number: "12" },
};

const CLINIC = {
  nameRu: "Нейрофакс",
  nameUz: "Neurofax",
  phone: "+998712000000",
  addressRu: "ул. Мирабад, 1",
  addressUz: "Mirobod ko'chasi, 1",
};

beforeEach(() => {
  state.conv = { patientId: "p1" };
  state.template = {
    bodyRu: REMINDER_24H.bodyRu,
    bodyUz: REMINDER_24H.bodyUz,
    trigger: REMINDER_24H.trigger,
  };
  state.clinic = { ...CLINIC };
  state.patient = {
    id: "p1",
    fullName: "Каримова Дилноза Алишеровна",
    phone: "+998901234567",
    preferredLang: "UZ",
  };
  state.appointments = [];
  state.visit = { ...VISIT };
});

describe("fillTemplate", () => {
  it("fills the reminder for a UZ patient in Uzbek: no braces left, her given name, the visit's time and doctor", () => {
    const res = fillTemplate({
      template: REMINDER_24H,
      patient: { fullName: "Каримова Дилноза Алишеровна", phone: "+998901234567", preferredLang: "UZ" },
      appointment: VISIT,
      clinic: CLINIC,
      fallbackLang: "ru",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lang).toBe("uz");
    expect(res.body).not.toContain("{{");
    expect(res.body.startsWith("Дилноза, eslatamiz")).toBe(true);
    expect(res.body).toContain("soat 10:30");
    expect(res.body).toContain("Sultonov Aziz");
    expect(res.body).toContain("+998712000000");
  });

  it("uses the patient's language, not the operator's", () => {
    const res = fillTemplate({
      template: REMINDER_24H,
      patient: { fullName: "Иванов Пётр", phone: "", preferredLang: "RU" },
      appointment: VISIT,
      clinic: CLINIC,
      fallbackLang: "uz",
    });
    expect(res).toMatchObject({ ok: true, lang: "ru" });
    if (res.ok) expect(res.body.startsWith("Пётр, напоминаем: завтра в 10:30")).toBe(true);
  });

  it("falls back to Russian when the Uzbek text was never written", () => {
    const res = fillTemplate({
      template: { bodyRu: "{{patient.firstName}}, ждём вас.", bodyUz: "   " },
      patient: { fullName: "Каримова Дилноза", phone: "", preferredLang: "UZ" },
      appointment: null,
      clinic: CLINIC,
      fallbackLang: "uz",
    });
    expect(res).toEqual({ ok: true, body: "Дилноза, ждём вас.", lang: "ru" });
  });

  it("does not HTML-escape: the chat is plain text, an apostrophe stays an apostrophe", () => {
    const res = fillTemplate({
      template: { bodyRu: "{{patient.firstName}}", bodyUz: "{{patient.firstName}}, {{clinic.address}}" },
      patient: { fullName: "G'ulomova O'g'iloy", phone: "", preferredLang: "UZ" },
      appointment: null,
      clinic: CLINIC,
      fallbackLang: "ru",
    });
    expect(res).toEqual({ ok: true, body: "O'g'iloy, Mirobod ko'chasi, 1", lang: "uz" });
  });

  it("refuses a template about the patient in a thread with no card", () => {
    const res = fillTemplate({
      template: REMINDER_24H,
      patient: null,
      appointment: null,
      clinic: CLINIC,
      fallbackLang: "ru",
    });
    expect(res).toMatchObject({ ok: false, reason: "no_patient" });
  });

  it("refuses a visit template when the patient has no such visit", () => {
    const res = fillTemplate({
      template: REMINDER_24H,
      patient: { fullName: "Иванов Пётр", phone: "", preferredLang: "RU" },
      appointment: null,
      clinic: CLINIC,
      fallbackLang: "ru",
    });
    expect(res).toMatchObject({
      ok: false,
      reason: "no_appointment",
      fields: ["appointment.time", "appointment.doctor"],
    });
  });

  it("refuses rather than leaving a hole: no clinic phone, an unknown field", () => {
    const res = fillTemplate({
      template: {
        bodyRu: "Позвоните {{clinic.phone}}, к оплате {{payment.amount}}",
        bodyUz: "",
      },
      patient: { fullName: "Иванов Пётр", phone: "", preferredLang: "RU" },
      appointment: VISIT,
      clinic: { ...CLINIC, phone: null },
      fallbackLang: "ru",
    });
    expect(res).toEqual({
      ok: false,
      reason: "unresolved",
      fields: ["clinic.phone", "payment.amount"],
    });
  });

  it("fills a clinic-only template in an unlinked thread, in the operator's language", () => {
    const res = fillTemplate({
      template: { bodyRu: "Клиника {{clinic.name}}", bodyUz: "{{clinic.name}} klinikasi" },
      patient: null,
      appointment: null,
      clinic: CLINIC,
      fallbackLang: "uz",
    });
    expect(res).toEqual({ ok: true, body: "Neurofax klinikasi", lang: "uz" });
  });
});

describe("helpers", () => {
  it("the given name is the second word of «Фамилия Имя Отчество»", () => {
    expect(givenNameOf("Каримова Дилноза Алишеровна")).toBe("Дилноза");
    expect(givenNameOf("  Дилноза ")).toBe("Дилноза");
    expect(givenNameOf("")).toBe("");
  });

  it("a cancellation or no-show text quotes THAT visit, not the next booking", () => {
    expect(visitPickFor("APPOINTMENT_CANCELLED")).toBe("CANCELLED");
    expect(visitPickFor("APPOINTMENT_MISSED")).toBe("NO_SHOW");
    expect(visitPickFor("APPOINTMENT_COMPLETED")).toBe("COMPLETED");
    expect(visitPickFor("APPOINTMENT_BEFORE")).toBe("upcoming");
    expect(visitPickFor("MANUAL")).toBe("upcoming");
  });

  it("renderPlainWithReport leaves an unresolved field in place and lists it", () => {
    expect(
      renderPlainWithReport("{{a}} и {{ b }}", { a: "x", b: "  " }),
    ).toEqual({ output: "x и {{ b }}", unresolved: ["b"] });
  });
});

describe("fillTemplateForConversation", () => {
  it("fills from the thread's card and its next visit from the start of the clinic's day", async () => {
    const res = await fillTemplateForConversation({
      clinicId: "clinic_A",
      conversationId: "conv_1",
      templateId: "tpl_1",
      fallbackLang: "ru",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    expect(res).toMatchObject({ ok: true, lang: "uz" });
    expect(state.appointments).toHaveLength(1);
    expect(state.appointments[0]!.where).toMatchObject({
      clinicId: "clinic_A",
      patientId: "p1",
      status: { in: ["BOOKED", "CONFIRMED", "WAITING"] },
      date: { gte: new Date("2026-10-05T19:00:00.000Z") },
    });
    expect(state.appointments[0]!.orderBy).toEqual({ date: "asc" });
  });

  it("a cancellation template reads the latest cancelled visit", async () => {
    state.template = {
      bodyRu: "Приём {{appointment.date}} отменён",
      bodyUz: "",
      trigger: "APPOINTMENT_CANCELLED",
    };
    await fillTemplateForConversation({
      clinicId: "clinic_A",
      conversationId: "conv_1",
      templateId: "tpl_1",
      fallbackLang: "ru",
    });
    expect(state.appointments[0]!.where).toMatchObject({ status: "CANCELLED" });
    expect(state.appointments[0]!.orderBy).toEqual({ date: "desc" });
  });

  it("does not look a visit up for a template that names none", async () => {
    state.template = { bodyRu: "{{patient.firstName}}, здравствуйте", bodyUz: "", trigger: "MANUAL" };
    const res = await fillTemplateForConversation({
      clinicId: "clinic_A",
      conversationId: "conv_1",
      templateId: "tpl_1",
      fallbackLang: "ru",
    });
    expect(res).toEqual({ ok: true, body: "Дилноза, здравствуйте", lang: "ru" });
    expect(state.appointments).toEqual([]);
  });

  it("an unlinked thread refuses a patient template", async () => {
    state.conv = { patientId: null };
    const res = await fillTemplateForConversation({
      clinicId: "clinic_A",
      conversationId: "conv_1",
      templateId: "tpl_1",
      fallbackLang: "ru",
    });
    expect(res).toMatchObject({ ok: false, reason: "no_patient" });
  });

  it("null for a thread or a template of another clinic", async () => {
    state.template = null;
    expect(
      await fillTemplateForConversation({
        clinicId: "clinic_A",
        conversationId: "conv_1",
        templateId: "tpl_other",
        fallbackLang: "ru",
      }),
    ).toBeNull();
  });
});
