/**
 * Unit tests for trigger registry export surface.
 * We don't spin up Prisma here; this is a light sanity check that the
 * trigger key set is the one documented in TZ §6.9.
 */
import { describe, it, expect } from "vitest";

import { TRIGGER_KEYS } from "@/server/notifications/triggers";

describe("TRIGGER_KEYS", () => {
  it("exposes the 7 required triggers in the documented order", () => {
    expect([...TRIGGER_KEYS]).toEqual([
      "appointment.created",
      "appointment.reminder-24h",
      "appointment.reminder-2h",
      "appointment.cancelled",
      "birthday",
      "no-show",
      "payment.due",
    ]);
  });

  it("is a tuple-const (readonly) length 7", () => {
    expect(TRIGGER_KEYS.length).toBe(7);
  });
});
