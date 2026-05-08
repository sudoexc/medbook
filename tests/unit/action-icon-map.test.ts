/**
 * Smoke test for the Action Center icon map (Phase 13 Wave 3).
 *
 * The Action Center page and the reception briefing tile both rely on
 * `ACTION_ICONS[row.type]` rendering a real component — if the union grows
 * and the map is missed, the page crashes with `Icon is not a function`. The
 * compile-time `Record<ActionType, LucideIcon>` constraint already enforces
 * exhaustiveness, but a stray `as unknown as ...` cast or a JSX-runtime
 * mismatch could still slip past tsc; this test is the runtime backstop.
 */
import { describe, it, expect } from "vitest";

import { ACTION_TYPES } from "@/lib/actions/types";
import { ACTION_ICONS } from "@/lib/actions/icons";

describe("ACTION_ICONS", () => {
  it("defines an icon for every ActionType", () => {
    for (const t of ACTION_TYPES) {
      const icon = ACTION_ICONS[t];
      expect(icon, `icon for ${t}`).toBeDefined();
      expect(icon, `icon for ${t}`).not.toBeNull();
      // lucide-react icons are forwardRef components — i.e. callable functions.
      expect(typeof icon, `icon for ${t}`).toBe("object");
    }
  });

  it("does not reuse the same icon for two different types", () => {
    // Soft check — if two detectors *should* share a glyph in the future this
    // can be relaxed, but right now visual differentiation matters: we want
    // a doctor-overload card to look distinct from an idle-room card.
    const seen = new Map<unknown, string>();
    for (const t of ACTION_TYPES) {
      const icon = ACTION_ICONS[t];
      const prev = seen.get(icon);
      expect(prev, `icon shared between ${prev} and ${t}`).toBeUndefined();
      seen.set(icon, t);
    }
  });

  it("has exactly as many entries as ACTION_TYPES", () => {
    const keys = Object.keys(ACTION_ICONS);
    expect(keys.length).toBe(ACTION_TYPES.length);
    for (const k of keys) {
      expect(ACTION_TYPES).toContain(k as (typeof ACTION_TYPES)[number]);
    }
  });
});
