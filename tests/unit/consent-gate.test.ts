/**
 * Phase 17 Wave 1 — Unit tests for the consent gate.
 *
 * These cases mirror the four matrix cells called out in the spec:
 *   - soft-deleted patient never receives anything
 *   - transactional always allowed when not deleted
 *   - marketing + opt-OUT blocks
 *   - legacy `null` marketingOptOut is treated as not-opted-out
 */
import { describe, expect, it } from "vitest";

import { isAllowedToReceive } from "@/server/notifications/consent-gate";

describe("isAllowedToReceive — consent gate", () => {
  it("blocks soft-deleted patient regardless of kind", () => {
    const p = { marketingOptOut: false, deletedAt: new Date() };
    expect(isAllowedToReceive(p, "transactional")).toEqual({
      allowed: false,
      reason: "deleted",
    });
    expect(isAllowedToReceive(p, "marketing")).toEqual({
      allowed: false,
      reason: "deleted",
    });
  });

  it("allows transactional when not deleted (even if opted out)", () => {
    const p = { marketingOptOut: true, deletedAt: null };
    expect(isAllowedToReceive(p, "transactional")).toEqual({ allowed: true });
  });

  it("blocks marketing when patient opted out", () => {
    const p = { marketingOptOut: true, deletedAt: null };
    expect(isAllowedToReceive(p, "marketing")).toEqual({
      allowed: false,
      reason: "opted_out",
    });
  });

  it("allows marketing when patient has not opted out", () => {
    const p = { marketingOptOut: false, deletedAt: null };
    expect(isAllowedToReceive(p, "marketing")).toEqual({ allowed: true });
  });

  it("treats legacy null marketingOptOut as not opted out", () => {
    const p = { marketingOptOut: null, deletedAt: null };
    expect(isAllowedToReceive(p, "marketing")).toEqual({ allowed: true });
  });

  it("blocks marketing for soft-deleted with opt-OUT (deletion wins)", () => {
    const p = { marketingOptOut: true, deletedAt: new Date() };
    expect(isAllowedToReceive(p, "marketing")).toEqual({
      allowed: false,
      reason: "deleted",
    });
  });
});
