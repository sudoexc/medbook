/**
 * Unit tests for trigger registry export surface.
 * We don't spin up Prisma here; this is a light sanity check that the
 * trigger key set matches the runtime registry. Phase 9 added the
 * `appointment.reminder-5h` and `case.repeat-due` triggers (tasks #225/#226).
 * Phase 14 (Wave 2) added `patient.reactivation` for the dormant-patient
 * reactivation engine. Phase 16 Wave 3 added `medication.reminder` and
 * `referral.reward-earned` for the medication-compliance and refer-a-friend
 * loops. TZ-notifications-cancel-sync added the day-of cascade
 * (`appointment.thank-you`, `-3h`, `-1h`, surface-aware cancel variants,
 * `appointment.running-late`, `appointment.no-show`). TZ-risk-outcomes §7
 * added `appointment.reminder-5d` for the 5d/3d/1d/3h cascade.
 */
import { describe, it, expect } from "vitest";

import { TRIGGER_KEYS } from "@/server/notifications/triggers";

describe("TRIGGER_KEYS", () => {
  it("exposes all 23 triggers in the documented order", () => {
    expect([...TRIGGER_KEYS]).toEqual([
      "appointment.created",
      "appointment.thank-you",
      "appointment.reminder-5d",
      "appointment.reminder-3d",
      "appointment.reminder-24h",
      "appointment.reminder-5h",
      "appointment.reminder-3h",
      "appointment.reminder-2h",
      "appointment.reminder-1h",
      "appointment.cancelled",
      "appointment.cancelled.by-staff",
      "appointment.cancelled.by-patient",
      "appointment.running-late",
      "appointment.no-show",
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

  it("is a tuple-const (readonly) length 23", () => {
    expect(TRIGGER_KEYS.length).toBe(23);
  });
});
