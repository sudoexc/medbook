/**
 * P1.2 — lab-result flag → tone mapping.
 *
 * `getLabFlagTone` is what paints a result "out of range" at a glance for a
 * patient who can't read a reference range, so the colour semantics are worth
 * pinning down without a database:
 *
 *   1. Every `LabFlag` enum member resolves to a complete tone (border + tint +
 *      label) — a missing entry would render a colourless pill for that flag.
 *   2. An unknown / future flag string falls back to NORMAL rather than
 *      throwing or returning undefined — the screen must never crash on a value
 *      the API added before the client shipped.
 *   3. The three abnormal flags are visually distinct from NORMAL, so "повышен"
 *      can't masquerade as "норма".
 */
import { describe, expect, it } from "vitest";

import {
  LAB_FLAG_TONES,
  getLabFlagTone,
} from "@/app/c/[slug]/my/_components/mini-app-tokens";

const FLAGS = ["NORMAL", "LOW", "HIGH", "CRITICAL"] as const;

describe("getLabFlagTone", () => {
  it("returns a complete tone for every LabFlag member", () => {
    for (const flag of FLAGS) {
      const tone = getLabFlagTone(flag);
      expect(tone, `tone for ${flag}`).toBeDefined();
      expect(tone.border, `${flag}.border`).toBeTruthy();
      expect(tone.tint, `${flag}.tint`).toBeTruthy();
      expect(tone.label, `${flag}.label`).toBeTruthy();
    }
  });

  it("falls back to NORMAL for an unknown flag", () => {
    expect(getLabFlagTone("WHO_KNOWS")).toEqual(LAB_FLAG_TONES.NORMAL);
    expect(getLabFlagTone("")).toEqual(LAB_FLAG_TONES.NORMAL);
  });

  it("paints each abnormal flag distinctly from NORMAL", () => {
    const normal = getLabFlagTone("NORMAL").label;
    for (const flag of ["LOW", "HIGH", "CRITICAL"] as const) {
      expect(getLabFlagTone(flag).label, `${flag} must not read as NORMAL`).not.toBe(
        normal,
      );
    }
  });
});
