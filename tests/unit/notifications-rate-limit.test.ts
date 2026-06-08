/**
 * Unit tests for the per-patient notification rate limiter.
 * Uses the in-memory implementation directly (no Redis required).
 *
 * SMS-bucketed scenarios from the pre-Wave 3 limiter were rewritten to
 * use TG once SMS removal landed (see `docs/TZ-sms-removal.md` Wave 3).
 * The structural assertions are channel-agnostic; only the channel label
 * changed.
 */
import { describe, it, expect } from "vitest";

import {
  InMemoryRateLimiter,
  DEFAULT_LIMITS,
} from "@/server/notifications/rate-limit";

describe("InMemoryRateLimiter", () => {
  it("allows up to maxHits then rejects", async () => {
    const rl = new InMemoryRateLimiter({
      TG: { windowMs: 60_000, maxHits: 3 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    expect(await rl.check("p1", "TG")).toBe(true);
    expect(await rl.check("p1", "TG")).toBe(true);
    expect(await rl.check("p1", "TG")).toBe(true);
    expect(await rl.check("p1", "TG")).toBe(false);
    expect(await rl.check("p1", "TG")).toBe(false);
  });

  it("scopes hits per patient", async () => {
    const rl = new InMemoryRateLimiter({
      TG: { windowMs: 60_000, maxHits: 1 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    expect(await rl.check("p1", "TG")).toBe(true);
    expect(await rl.check("p2", "TG")).toBe(true);
    expect(await rl.check("p1", "TG")).toBe(false);
  });

  it("scopes hits per channel", async () => {
    const rl = new InMemoryRateLimiter({
      TG: { windowMs: 60_000, maxHits: 1 },
      EMAIL: { windowMs: 60_000, maxHits: 5 },
      CALL: null,
      VISIT: null,
    });
    expect(await rl.check("p1", "TG")).toBe(true);
    expect(await rl.check("p1", "TG")).toBe(false);
    expect(await rl.check("p1", "EMAIL")).toBe(true);
  });

  it("reports remaining budget without consuming", async () => {
    const rl = new InMemoryRateLimiter({
      TG: { windowMs: 60_000, maxHits: 3 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    await rl.check("p1", "TG");
    expect(await rl.remaining("p1", "TG")).toBe(2);
    expect(await rl.remaining("p1", "TG")).toBe(2);
  });

  it("null limit = unlimited", async () => {
    const rl = new InMemoryRateLimiter({
      TG: null,
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    for (let i = 0; i < 100; i++) {
      expect(await rl.check("p1", "TG")).toBe(true);
    }
  });

  it("reset clears state", async () => {
    const rl = new InMemoryRateLimiter({
      TG: { windowMs: 60_000, maxHits: 1 },
      EMAIL: null,
      CALL: null,
      VISIT: null,
    });
    await rl.check("p1", "TG");
    expect(await rl.check("p1", "TG")).toBe(false);
    await rl.reset();
    expect(await rl.check("p1", "TG")).toBe(true);
  });

  it("default limits match spec (TG 10/min)", () => {
    expect(DEFAULT_LIMITS.TG).toEqual({
      windowMs: 60_000,
      maxHits: 10,
    });
  });
});
