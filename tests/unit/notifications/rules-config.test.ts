/**
 * Phase 8b/c — triggerConfig sanitisation + defaulting helpers.
 *
 * Covers:
 *   - sanitizeTriggerConfig clamps offsetMin into [-72*60, -30] and now only
 *     accepts `TG` as a valid channel (Wave 3 of `docs/TZ-sms-removal.md`
 *     narrowed the allow-list — EMAIL/CALL/VISIT are not exposed through the
 *     trigger editor)
 *   - resolveChannels honors triggerConfig.channels and demotes TG when the
 *     patient has no telegramId
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
  it("clamps offsetMin below -7d to -7d (widened for the 5d/3d cascade)", () => {
    const out = sanitizeTriggerConfig(
      { offsetMin: -100_000 },
      { kind: "before" },
    );
    expect(out.offsetMin).toBe(-7 * 24 * 60);
  });

  it("keeps a 5-day offset (was clamped under the old -72h bound)", () => {
    const out = sanitizeTriggerConfig(
      { offsetMin: -7200 },
      { kind: "before" },
    );
    expect(out.offsetMin).toBe(-7200);
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
    // SMS / EMAIL / random strings are all filtered; TG is the only allowed
    // channel after Wave 3 of `docs/TZ-sms-removal.md`. Duplicate TG entries
    // collapse to one.
    const out = sanitizeTriggerConfig(
      { channels: ["TG", "SMS", "TG", "EMAIL"] },
      { kind: "other" },
    );
    expect(out.channels).toEqual(["TG"]);
  });

  it("removes channels array when nothing valid remains", () => {
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
      "TG",
      { channels: ["TG", "EMAIL"] },
      { telegramId: "123" },
    );
    expect(out).toEqual(["TG", "EMAIL"]);
  });

  it("demotes TG when patient has no telegramId", () => {
    const out = resolveChannels(
      "TG",
      { channels: ["TG", "EMAIL"] },
      { telegramId: null },
    );
    expect(out[0]).toBe("EMAIL");
    expect(out).toContain("TG");
  });

  it("falls back to template.channel when no config", () => {
    const out = resolveChannels("TG", null, { telegramId: "123" });
    expect(out).toEqual(["TG"]);
  });

  it("falls back to template.channel when channels array is empty in config", () => {
    const out = resolveChannels(
      "TG",
      { channels: [] },
      { telegramId: "123" },
    );
    expect(out).toEqual(["TG"]);
  });

  it("strips legacy template.channel=SMS down to an empty list", () => {
    // Wave 3 of `docs/TZ-sms-removal.md` removed SMS as an active channel.
    // Legacy template rows may still carry the literal until the Wave 5
    // Prisma migration; the resolver returns [] for those so the materializer
    // raises the PATIENT_NO_CHANNEL action instead of dispatching SMS.
    const out = resolveChannels("SMS", null, { telegramId: "123" });
    expect(out).toEqual([]);
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
