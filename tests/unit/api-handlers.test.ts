/**
 * Schema validation tests for the Phase-1 CRM API schemas.
 *
 * These are pure Zod tests — they don't spin up Prisma or Next. The goal is
 * to catch schema regressions fast (valid inputs parse, invalid inputs fail
 * with predictable issues).
 */
import { describe, it, expect } from "vitest";

import {
  CreateAppointmentSchema,
  UpdateAppointmentSchema,
  QueryAppointmentSchema,
  SlotsQuerySchema,
  BulkStatusSchema,
} from "@/server/schemas/appointment";
import {
  CreatePatientSchema,
  UpdatePatientSchema,
} from "@/server/schemas/patient";
import { CreatePaymentSchema } from "@/server/schemas/payment";
import { CreateDocumentSchema } from "@/server/schemas/document";
import { SendSmsSchema } from "@/server/schemas/communication";
import { CreateTemplateSchema } from "@/server/schemas/notification";

describe("CreatePatientSchema", () => {
  it("accepts minimal valid input", () => {
    const r = CreatePatientSchema.safeParse({
      fullName: "Иван Иванов",
      phone: "+998 90 123-45-67",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty fullName", () => {
    const r = CreatePatientSchema.safeParse({ fullName: "", phone: "+998" });
    expect(r.success).toBe(false);
  });

  it("rejects missing phone", () => {
    const r = CreatePatientSchema.safeParse({ fullName: "Анна" });
    expect(r.success).toBe(false);
  });

  it("UpdatePatientSchema makes all keys optional", () => {
    const r = UpdatePatientSchema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe("CreateAppointmentSchema", () => {
  it("accepts valid appointment", () => {
    const r = CreateAppointmentSchema.safeParse({
      patientId: "pat_1",
      doctorId: "doc_1",
      date: "2026-04-22",
      time: "10:00",
      durationMin: 30,
      channel: "WALKIN",
    });
    expect(r.success).toBe(true);
  });

  it("rejects bad time format", () => {
    const r = CreateAppointmentSchema.safeParse({
      patientId: "pat_1",
      doctorId: "doc_1",
      date: "2026-04-22",
      time: "10-00",
      durationMin: 30,
      channel: "WALKIN",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-positive durationMin", () => {
    const r = CreateAppointmentSchema.safeParse({
      patientId: "pat_1",
      doctorId: "doc_1",
      date: "2026-04-22",
      durationMin: 0,
      channel: "WALKIN",
    });
    expect(r.success).toBe(false);
  });

  it("UpdateAppointmentSchema accepts partial update", () => {
    const r = UpdateAppointmentSchema.safeParse({ status: "COMPLETED" });
    expect(r.success).toBe(true);
  });

  it("QueryAppointmentSchema coerces date/limit strings", () => {
    const r = QueryAppointmentSchema.safeParse({
      from: "2026-04-01",
      to: "2026-04-30",
      limit: "25",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });

  it("SlotsQuerySchema requires doctorId and date", () => {
    const miss = SlotsQuerySchema.safeParse({ date: "2026-04-22" });
    expect(miss.success).toBe(false);
    const ok = SlotsQuerySchema.safeParse({
      doctorId: "doc_1",
      date: "2026-04-22",
    });
    expect(ok.success).toBe(true);
  });

  it("BulkStatusSchema requires at least one id", () => {
    const empty = BulkStatusSchema.safeParse({ ids: [], status: "CANCELLED" });
    expect(empty.success).toBe(false);
  });
});

describe("CreatePaymentSchema", () => {
  it("rejects negative amount", () => {
    const r = CreatePaymentSchema.safeParse({
      amount: -100,
      method: "CASH",
      status: "PAID",
    });
    expect(r.success).toBe(false);
  });

  it("defaults currency to UZS", () => {
    const r = CreatePaymentSchema.safeParse({
      amount: 1000,
      method: "CASH",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("UZS");
  });
});

describe("CreateDocumentSchema", () => {
  it("requires patientId, type, title, fileUrl", () => {
    const r = CreateDocumentSchema.safeParse({ type: "RECEIPT" });
    expect(r.success).toBe(false);
  });
});

describe("SendSmsSchema", () => {
  it("requires phone and body", () => {
    expect(SendSmsSchema.safeParse({ phone: "" }).success).toBe(false);
    expect(
      SendSmsSchema.safeParse({ phone: "+998901234567", body: "hi" }).success
    ).toBe(true);
  });
});

describe("CreateTemplateSchema", () => {
  it("accepts valid template", () => {
    const r = CreateTemplateSchema.safeParse({
      key: "reminder_24h",
      nameRu: "Напоминание за 24ч",
      nameUz: "24 soat oldin eslatma",
      channel: "SMS",
      category: "REMINDER",
      bodyRu: "Завтра в {{time}}",
      bodyUz: "Ertaga {{time}}da",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid channel", () => {
    const r = CreateTemplateSchema.safeParse({
      key: "x",
      nameRu: "n",
      nameUz: "n",
      channel: "CARRIER_PIGEON",
      category: "REMINDER",
      bodyRu: "b",
      bodyUz: "b",
    });
    expect(r.success).toBe(false);
  });
});
