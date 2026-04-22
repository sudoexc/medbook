/**
 * Unit tests for the per-patient notification rate limiter.
 * Uses the in-memory implementation directly (no Redis required).
 */
import { describe, it, expect } from "vitest";

import {
  InMemoryRateLimiter,
  DEFAULT_LIMITS,
} from "@/server/notifications/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("allows up to maxHits then rejects", async () => {
    const rl = new InMemoryRateLimiter({
      SMS: { windowMs: 60_000, maxHits: 3 },
      TG: { windowMs: 60_000, maxHits: 3 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    expect(await rl.check("p1", "SMS")).toBe(true);
    expect(await rl.check("p1", "SMS")).toBe(true);
    expect(await rl.check("p1", "SMS")).toBe(true);
    expect(await rl.check("p1", "SMS")).toBe(false);
    expect(await rl.check("p1", "SMS")).toBe(false);
  });

  it("scopes hits per patient", async () => {
    const rl = new InMemoryRateLimiter({
      SMS: { windowMs: 60_000, maxHits: 1 },
      TG: { windowMs: 60_000, maxHits: 1 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    expect(await rl.check("p1", "SMS")).toBe(true);
    expect(await rl.check("p2", "SMS")).toBe(true);
    expect(await rl.check("p1", "SMS")).toBe(false);
  });

  it("scopes hits per channel", async () => {
    const rl = new InMemoryRateLimiter({
      SMS: { windowMs: 60_000, maxHits: 1 },
      TG: { windowMs: 60_000, maxHits: 5 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    expect(await rl.check("p1", "SMS")).toBe(true);
    expect(await rl.check("p1", "SMS")).toBe(false);
    expect(await rl.check("p1", "TG")).toBe(true);
  });

  it("reports remaining budget without consuming", async () => {
    const rl = new InMemoryRateLimiter({
      SMS: { windowMs: 60_000, maxHits: 3 },
      TG: { windowMs: 60_000, maxHits: 3 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    await rl.check("p1", "SMS");
    expect(await rl.remaining("p1", "SMS")).toBe(2);
    expect(await rl.remaining("p1", "SMS")).toBe(2);
  });

  it("null limit = unlimited", async () => {
    const rl = new InMemoryRateLimiter({
      SMS: null,
      TG: null,
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    for (let i = 0; i < 100; i++) {
      expect(await rl.check("p1", "SMS")).toBe(true);
    }
  });

  it("reset clears state", async () => {
    const rl = new InMemoryRateLimiter({
      SMS: { windowMs: 60_000, maxHits: 1 },
      TG: null,
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    await rl.check("p1", "SMS");
    expect(await rl.check("p1", "SMS")).toBe(false);
    await rl.reset();
    expect(await rl.check("p1", "SMS")).toBe(true);
  });

  it("default limits match spec (SMS 3/hr, TG 10/min)", () => {
    expect(DEFAULT_LIMITS.SMS).toEqual({
      windowMs: 3_600_000,
      maxHits: 3,
    });
    expect(DEFAULT_LIMITS.TG).toEqual({
      windowMs: 60_000,
      maxHits: 10,
    });
  });
});
