/**
 * Phase 17 Wave 1 — Unit tests for SMS STOP keyword detection.
 *
 * Covers the supported keyword set (English / Russian / Uzbek + apostrophe-
 * less and zero-typo variants), case insensitivity, whitespace trimming,
 * and the "must be the whole message" rule.
 */
import { describe, expect, it } from "vitest";

import { isStopKeyword, stopReply } from "@/lib/sms-stop";

describe("isStopKeyword", () => {
  it.each([
    "STOP",
    "stop",
    "Stop",
    "СТОП",
    "стоп",
    "TO'XTAT",
    "to'xtat",
    "TOXTAT",
    "T0XTAT",
    "ОТПИСАТЬСЯ",
    "отписаться",
  ])("matches %s", (kw) => {
    expect(isStopKeyword(kw)).toBe(true);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(isStopKeyword("  STOP  ")).toBe(true);
    expect(isStopKeyword("\tстоп\n")).toBe(true);
  });

  it("does not match when keyword is part of a longer message", () => {
    expect(isStopKeyword("stop the spam")).toBe(false);
    expect(isStopKeyword("please STOP sending me texts")).toBe(false);
    expect(isStopKeyword("hi there")).toBe(false);
  });

  it("returns false for empty / nullish input", () => {
    expect(isStopKeyword("")).toBe(false);
    expect(isStopKeyword("   ")).toBe(false);
    expect(isStopKeyword(null)).toBe(false);
    expect(isStopKeyword(undefined)).toBe(false);
  });
});

describe("stopReply", () => {
  it("returns RU reply by default", () => {
    expect(stopReply(null)).toMatch(/Вы отписались/);
    expect(stopReply(undefined)).toMatch(/Вы отписались/);
    expect(stopReply("RU")).toMatch(/Вы отписались/);
  });

  it("returns UZ reply for UZ", () => {
    expect(stopReply("UZ")).toMatch(/obunani bekor/);
  });
});
