/**
 * Phase 8b/c — triggerConfig sanitisation + defaulting helpers.
 *
 * Covers:
 *   - sanitizeTriggerConfig clamps offsetMin into [-72*60, -30]
 *   - resolveChannels honors triggerConfig.channels and re-orders TG↓SMS
 *     when patient has no telegramId
 *   - resolveOffsetMin returns the configured value, or fallback
 *   - isTriggerEnabled ANDs isActive with triggerConfig.enabled
 */
import { describe, it, expect } from "vitest";

import {
  isTriggerEnabled,
  resolveChannels,
  resolveOffsetMin,
  sanitizeTriggerConfig,
} from "@/server/notifications/rules";

describe("sanitizeTriggerConfig", () => {
  it("clamps offsetMin below -72h to -72h", () => {
    const out = sanitizeTriggerConfig(
      { offsetMin: -100_000 },
      { kind: "before" },
    );
    expect(out.offsetMin).toBe(-72 * 60);
  });

  it("clamps offsetMin above -30 to -30", () => {
    const out = sanitizeTriggerConfig(
      { offsetMin: -10 },
      { kind: "before" },
    );
    expect(out.offsetMin).toBe(-30);
  });

  it("keeps offsetMin in range", () => {
    const out = sanitizeTriggerConfig(
      { offsetMin: -1380 },
      { kind: "before" },
    );
    expect(out.offsetMin).toBe(-1380);
  });

  it("strips invalid channels and dedupes valid ones", () => {
    const out = sanitizeTriggerConfig(
      { channels: ["TG", "SMS", "TG", "EMAIL"] },
      { kind: "other" },
    );
    expect(out.channels).toEqual(["TG", "SMS"]);
  });

  it("removes empty channels array", () => {
    const out = sanitizeTriggerConfig(
      { channels: ["EMAIL"] },
      { kind: "other" },
    );
    expect(out.channels).toBeUndefined();
  });

  it("preserves unrelated keys (round-trip)", () => {
    const out = sanitizeTriggerConfig(
      { days: 180, foo: "bar" },
      { kind: "other" },
    );
    expect(out.days).toBe(180);
    expect(out.foo).toBe("bar");
  });
});

describe("resolveChannels", () => {
  it("uses configured channels in order when patient has telegramId", () => {
    const out = resolveChannels(
      "SMS",
      { channels: ["TG", "SMS"] },
      { telegramId: "123" },
    );
    expect(out).toEqual(["TG", "SMS"]);
  });

  it("demotes TG when patient has no telegramId", () => {
    const out = resolveChannels(
      "TG",
      { channels: ["TG", "SMS"] },
      { telegramId: null },
    );
    expect(out[0]).toBe("SMS");
    expect(out).toContain("TG");
  });

  it("falls back to template.channel when no config", () => {
    const out = resolveChannels("SMS", null, { telegramId: "123" });
    expect(out).toEqual(["SMS"]);
  });

  it("falls back to template.channel when channels array is empty in config", () => {
    const out = resolveChannels(
      "TG",
      { channels: [] },
      { telegramId: "123" },
    );
    expect(out).toEqual(["TG"]);
  });
});

describe("resolveOffsetMin", () => {
  it("returns configured offset when present", () => {
    expect(resolveOffsetMin({ offsetMin: -180 }, -1440)).toBe(-180);
  });

  it("returns fallback when missing", () => {
    expect(resolveOffsetMin(null, -1440)).toBe(-1440);
    expect(resolveOffsetMin({}, -1440)).toBe(-1440);
  });

  it("returns fallback when value is NaN/non-number", () => {
    expect(resolveOffsetMin({ offsetMin: "abc" }, -1440)).toBe(-1440);
  });
});

describe("isTriggerEnabled", () => {
  it("returns false if isActive=false", () => {
    expect(isTriggerEnabled(false, null)).toBe(false);
    expect(isTriggerEnabled(false, { enabled: true })).toBe(false);
  });

  it("returns true when isActive and enabled missing", () => {
    expect(isTriggerEnabled(true, null)).toBe(true);
    expect(isTriggerEnabled(true, {})).toBe(true);
  });

  it("returns false when triggerConfig.enabled === false", () => {
    expect(isTriggerEnabled(true, { enabled: false })).toBe(false);
  });
});
