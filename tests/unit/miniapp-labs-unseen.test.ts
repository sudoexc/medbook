/**
 * "New lab results" badge arithmetic (Mini App home).
 *
 * The labs screen had no entry point at all, so a doctor marking a result
 * REVIEWED was invisible to the patient. The home badge is the fix, and its
 * counting rule is what decides whether the patient ever notices.
 */
import { describe, expect, it } from "vitest";

import { countUnseenLabs } from "@/app/c/[slug]/my/_lib/labs-unseen";

const T = (iso: string) => ({ reviewedAt: iso });

describe("countUnseenLabs", () => {
  it("counts everything when the screen was never opened", () => {
    const labs = [T("2026-06-01T10:00:00.000Z"), T("2026-05-01T10:00:00.000Z")];
    expect(countUnseenLabs(labs, null)).toBe(2);
  });

  it("counts only results reviewed after the last visit to the screen", () => {
    const seenAt = Date.parse("2026-06-01T00:00:00.000Z");
    const labs = [
      T("2026-06-02T10:00:00.000Z"), // new
      T("2026-06-01T10:00:00.000Z"), // new
      T("2026-05-30T10:00:00.000Z"), // already seen
    ];
    expect(countUnseenLabs(labs, seenAt)).toBe(2);
  });

  it("treats a result reviewed exactly at the marker as already seen", () => {
    const seenAt = Date.parse("2026-06-01T00:00:00.000Z");
    expect(countUnseenLabs([T("2026-06-01T00:00:00.000Z")], seenAt)).toBe(0);
  });

  it("never counts results without a usable reviewedAt", () => {
    // An undated row can't be ordered against the marker; counting it would
    // pin the badge on permanently with no way for the patient to clear it.
    const labs = [{ reviewedAt: null }, { reviewedAt: "not-a-date" }];
    expect(countUnseenLabs(labs, null)).toBe(0);
    expect(countUnseenLabs(labs, Date.now())).toBe(0);
  });

  it("is zero for empty / missing input", () => {
    expect(countUnseenLabs([], null)).toBe(0);
    expect(countUnseenLabs(undefined, null)).toBe(0);
    expect(countUnseenLabs(null, 1)).toBe(0);
  });
});
