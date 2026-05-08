/**
 * Phase 18 Wave 4 — zod contract for the schedule API.
 *
 * Mirrors the W4 spec's "422 on bad email / TG chat-id" line. The route
 * handlers AND this test pull the schemas from the same module — if the
 * regex drifts in either direction, both shift together.
 */
import { describe, it, expect } from "vitest";

import {
  CreateScheduleBodySchema,
  UpdateScheduleBodySchema,
  isValidEmail,
  isValidTelegramChatId,
} from "@/server/analytics/schedule-validation";

describe("CreateScheduleBodySchema", () => {
  it("accepts a well-formed email payload", () => {
    const r = CreateScheduleBodySchema.safeParse({
      cadence: "DAILY",
      deliveryChannel: "EMAIL",
      deliveryTarget: "ops@example.com",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed email with invalid_email", () => {
    const r = CreateScheduleBodySchema.safeParse({
      cadence: "DAILY",
      deliveryChannel: "EMAIL",
      deliveryTarget: "no-at-sign",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "invalid_email")).toBe(
        true,
      );
    }
  });

  it("accepts a numeric Telegram chat id (with leading minus)", () => {
    const r = CreateScheduleBodySchema.safeParse({
      cadence: "WEEKLY",
      deliveryChannel: "TELEGRAM",
      deliveryTarget: "-1001234567890",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-numeric chat id with invalid_telegram_chat_id", () => {
    const r = CreateScheduleBodySchema.safeParse({
      cadence: "WEEKLY",
      deliveryChannel: "TELEGRAM",
      deliveryTarget: "@channel",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.message === "invalid_telegram_chat_id"),
      ).toBe(true);
    }
  });

  it("defaults format to pdf when omitted", () => {
    const r = CreateScheduleBodySchema.safeParse({
      cadence: "DAILY",
      deliveryChannel: "EMAIL",
      deliveryTarget: "x@y.com",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.format).toBe("pdf");
  });

  it("rejects unknown cadence", () => {
    const r = CreateScheduleBodySchema.safeParse({
      cadence: "HOURLY",
      deliveryChannel: "EMAIL",
      deliveryTarget: "x@y.com",
    });
    expect(r.success).toBe(false);
  });
});

describe("UpdateScheduleBodySchema", () => {
  it("validates pair when both channel and target are present", () => {
    const r = UpdateScheduleBodySchema.safeParse({
      deliveryChannel: "EMAIL",
      deliveryTarget: "no-at-sign",
    });
    expect(r.success).toBe(false);
  });

  it("permits a partial channel-only update (route handler revalidates)", () => {
    const r = UpdateScheduleBodySchema.safeParse({ deliveryChannel: "EMAIL" });
    expect(r.success).toBe(true);
  });

  it("permits enabled-only patches", () => {
    const r = UpdateScheduleBodySchema.safeParse({ enabled: true });
    expect(r.success).toBe(true);
  });
});

describe("helpers", () => {
  it("isValidEmail trims input", () => {
    expect(isValidEmail(" ops@example.com ")).toBe(true);
    expect(isValidEmail("ops@example")).toBe(false);
  });
  it("isValidTelegramChatId trims input", () => {
    expect(isValidTelegramChatId(" 12345 ")).toBe(true);
    expect(isValidTelegramChatId("-1001234567890")).toBe(true);
    expect(isValidTelegramChatId("abc")).toBe(false);
    expect(isValidTelegramChatId("12")).toBe(false); // too short
  });
});
