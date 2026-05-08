/**
 * Unit tests for `groupByDay` — pure helper used by the patient timeline
 * to bucket events into "Today / Yesterday / absolute date" headers.
 *
 * The helper accepts an injectable `now` so tests don't rely on wall-clock
 * time. We assert on local-day keys (`YYYY-MM-DD`) and the relative-day
 * `label` field; absolute formatting belongs to the consumer.
 */
import { describe, it, expect } from "vitest";

import { groupByDay } from "@/lib/timeline/group-by-day";

function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("groupByDay", () => {
  it("returns an empty array for empty input", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("buckets items into local-day groups, newest first", () => {
    const now = new Date(2026, 4, 6, 12, 0, 0); // 2026-05-06 12:00 local

    const items = [
      { id: "a", at: new Date(2026, 4, 6, 9, 0, 0) }, // today 09:00
      { id: "b", at: new Date(2026, 4, 6, 11, 0, 0) }, // today 11:00
      { id: "c", at: new Date(2026, 4, 5, 16, 0, 0) }, // yesterday
      { id: "d", at: new Date(2026, 3, 12, 10, 0, 0) }, // older
    ];

    const groups = groupByDay(items, now);
    expect(groups).toHaveLength(3);

    expect(groups[0].label).toBe("today");
    expect(groups[0].key).toBe(localKey(items[0].at));
    expect(groups[0].items.map((it) => it.id)).toEqual(["a", "b"]);

    expect(groups[1].label).toBe("yesterday");
    expect(groups[1].items.map((it) => it.id)).toEqual(["c"]);

    expect(groups[2].label).toBe("absolute");
    expect(groups[2].items.map((it) => it.id)).toEqual(["d"]);
  });

  it("accepts ISO strings as `at`", () => {
    const now = new Date(2026, 4, 6, 12, 0, 0);
    const items = [
      { id: "x", at: new Date(2026, 4, 6, 8, 0, 0).toISOString() },
      { id: "y", at: new Date(2026, 4, 5, 8, 0, 0).toISOString() },
    ];
    const groups = groupByDay(items, now);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("today");
    expect(groups[1].label).toBe("yesterday");
  });

  it("skips items with invalid dates", () => {
    const now = new Date(2026, 4, 6, 12, 0, 0);
    const items = [
      { id: "a", at: new Date(2026, 4, 6, 9, 0, 0) },
      { id: "b", at: "not-a-date" },
    ];
    const groups = groupByDay(items, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((it) => it.id)).toEqual(["a"]);
  });
});
