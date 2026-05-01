/**
 * Phase 8b/c — variable validation against ALLOWED_KEYS_BY_TRIGGER.
 *
 * Covers:
 *   - logicalTriggerKey() correctly maps DB enum + offsetMin → logical key
 *   - allowedKeysFor() returns a non-empty list per trigger
 *   - validate() flags placeholders that aren't whitelisted for the trigger
 */
import { describe, it, expect } from "vitest";

import {
  allowedKeysFor,
  logicalTriggerKey,
} from "@/server/notifications/rules";
import { validate } from "@/server/notifications/template";

describe("logicalTriggerKey", () => {
  it("maps APPOINTMENT_BEFORE with offsetMin=-1440 to reminder-24h", () => {
    expect(
      logicalTriggerKey("APPOINTMENT_BEFORE", { offsetMin: -1440 }, "reminder.24h"),
    ).toBe("appointment.reminder-24h");
  });

  it("maps APPOINTMENT_BEFORE with offsetMin=-120 to reminder-2h", () => {
    expect(
      logicalTriggerKey("APPOINTMENT_BEFORE", { offsetMin: -120 }, "reminder.2h"),
    ).toBe("appointment.reminder-2h");
  });

  it("maps APPOINTMENT_BEFORE with offsetMin=-90 to reminder-2h slot", () => {
    expect(
      logicalTriggerKey("APPOINTMENT_BEFORE", { offsetMin: -90 }, "reminder.x"),
    ).toBe("appointment.reminder-2h");
  });

  it("maps APPOINTMENT_BEFORE with offsetMin=-1380 to reminder-24h slot", () => {
    expect(
      logicalTriggerKey("APPOINTMENT_BEFORE", { offsetMin: -1380 }, "reminder.x"),
    ).toBe("appointment.reminder-24h");
  });

  it("maps PATIENT_BIRTHDAY → birthday", () => {
    expect(logicalTriggerKey("PATIENT_BIRTHDAY", null, "marketing.birthday")).toBe(
      "birthday",
    );
  });

  it("uses key fallback for appointment.cancelled", () => {
    expect(
      logicalTriggerKey("APPOINTMENT_CREATED", null, "appointment.cancelled"),
    ).toBe("appointment.cancelled");
  });

  it("falls back to manual for unknown enum + key", () => {
    expect(logicalTriggerKey("CRON", null, "marketing.promo")).toBe("manual");
  });
});

describe("allowedKeysFor", () => {
  it("returns the trigger-specific whitelist", () => {
    const keys = allowedKeysFor("appointment.created");
    expect(keys).toContain("patient.firstName");
    expect(keys).toContain("appointment.cabinet");
  });

  it("returns the union of all whitelists for manual templates", () => {
    const keys = allowedKeysFor("manual");
    expect(keys).toContain("patient.name");
    expect(keys).toContain("payment.amount");
    expect(keys).toContain("appointment.cabinet");
  });
});

describe("validate against allowedKeysFor", () => {
  it("rejects unknown placeholder for reminder-24h", () => {
    const allowed = allowedKeysFor("appointment.reminder-24h");
    const r = validate("Hi {{patient.firstName}} on {{appointment.cabinet}}", allowed);
    // "appointment.cabinet" is NOT in reminder-24h whitelist
    expect(r.ok).toBe(false);
    expect(r.unknown).toContain("appointment.cabinet");
  });

  it("accepts only whitelisted placeholders for birthday", () => {
    const allowed = allowedKeysFor("birthday");
    const r = validate("С днём рождения, {{patient.firstName}}!", allowed);
    expect(r.ok).toBe(true);
  });

  it("rejects unknown nested key entirely", () => {
    const allowed = allowedKeysFor("payment.due");
    const r = validate("{{hack.token}}", allowed);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["hack.token"]);
  });

  it("accepts manual templates with cross-trigger placeholders", () => {
    const allowed = allowedKeysFor("manual");
    const r = validate(
      "{{patient.name}} {{appointment.cabinet}} {{payment.amount}}",
      allowed,
    );
    expect(r.ok).toBe(true);
  });
});
