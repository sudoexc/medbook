/**
 * Unit tests for trigger registry export surface.
 * We don't spin up Prisma here; this is a light sanity check that the
 * trigger key set matches the runtime registry. Phase 9 added the
 * `appointment.reminder-5h` and `case.repeat-due` triggers (tasks #225/#226).
 * Phase 14 (Wave 2) added `patient.reactivation` for the dormant-patient
 * reactivation engine. Phase 16 Wave 3 added `medication.reminder` and
 * `referral.reward-earned` for the medication-compliance and refer-a-friend
 * loops.
 */
import { describe, it, expect } from "vitest";

import { TRIGGER_KEYS } from "@/server/notifications/triggers";

describe("TRIGGER_KEYS", () => {
  it("exposes all 14 triggers in the documented order", () => {
    expect([...TRIGGER_KEYS]).toEqual([
      "appointment.created",
      "appointment.reminder-24h",
      "appointment.reminder-5h",
      "appointment.reminder-2h",
      "appointment.cancelled",
      "birthday",
      "no-show",
      "payment.due",
      "case.repeat-due",
      "patient.reactivation",
      "appointment.pre-visit-questionnaire",
      "appointment.nps-request",
      "medication.reminder",
      "referral.reward-earned",
    ]);
  });

  it("is a tuple-const (readonly) length 14", () => {
    expect(TRIGGER_KEYS.length).toBe(14);
  });
});
