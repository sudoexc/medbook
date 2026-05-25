/**
 * Phase 12 Wave 1 — `src/lib/appointments/lifecycle.ts`
 *
 * The state-machine helper that backs the visual lifecycle chain (drawer)
 * and the quick-action icon row (reception card). The underlying graph is
 * declared in `src/lib/appointment-transitions.ts` — these tests pin the
 * client-side gating that mirrors the server-side guard so the UI can hide
 * unreachable affordances before the user clicks.
 */
import { describe, it, expect } from "vitest";

import {
  LIFECYCLE_STEPS,
  canMutateStatus,
  getAllowedTransitions,
  getAllowedTransitionsAt,
  getQuickActions,
  getStepStates,
} from "@/lib/appointments/lifecycle";

describe("getAllowedTransitions", () => {
  it("BOOKED → WAITING is valid for RECEPTIONIST", () => {
    const next = getAllowedTransitions("BOOKED", "RECEPTIONIST");
    expect(next).toContain("WAITING");
    expect(next).toContain("IN_PROGRESS");
    expect(next).toContain("CANCELLED");
    expect(next).not.toContain("BOOKED"); // self-loop excluded
  });

  it("BOOKED → WAITING is valid for DOCTOR", () => {
    expect(getAllowedTransitions("BOOKED", "DOCTOR")).toContain("WAITING");
  });

  it("BOOKED → COMPLETED is forbidden (must pass through IN_PROGRESS)", () => {
    expect(getAllowedTransitions("BOOKED", "ADMIN")).not.toContain("COMPLETED");
  });

  it("COMPLETED is terminal — no transitions out", () => {
    expect(getAllowedTransitions("COMPLETED", "ADMIN")).toEqual([]);
  });

  it("CANCELLED is terminal — reopening is not allowed", () => {
    expect(getAllowedTransitions("CANCELLED", "ADMIN")).toEqual([]);
    expect(getAllowedTransitions("CANCELLED", "RECEPTIONIST")).toEqual([]);
  });

  it("NO_SHOW is terminal — cannot transition to BOOKED", () => {
    expect(getAllowedTransitions("NO_SHOW", "ADMIN")).toEqual([]);
  });

  it("COMPLETED → BOOKED is forbidden (cannot rewind a completed visit)", () => {
    const next = getAllowedTransitions("COMPLETED", "ADMIN");
    expect(next).not.toContain("BOOKED");
  });

  it("NURSE cannot mutate any status (read-only role)", () => {
    expect(getAllowedTransitions("BOOKED", "NURSE")).toEqual([]);
    expect(getAllowedTransitions("WAITING", "NURSE")).toEqual([]);
    expect(canMutateStatus("NURSE")).toBe(false);
  });

  it("CALL_OPERATOR cannot advance visit lifecycle in this wave", () => {
    expect(getAllowedTransitions("BOOKED", "CALL_OPERATOR")).toEqual([]);
    expect(canMutateStatus("CALL_OPERATOR")).toBe(false);
  });

  it("SUPER_ADMIN, ADMIN, RECEPTIONIST, DOCTOR can mutate", () => {
    expect(canMutateStatus("SUPER_ADMIN")).toBe(true);
    expect(canMutateStatus("ADMIN")).toBe(true);
    expect(canMutateStatus("RECEPTIONIST")).toBe(true);
    expect(canMutateStatus("DOCTOR")).toBe(true);
  });
});

describe("getAllowedTransitionsAt — NO_SHOW gating", () => {
  it("NO_SHOW only valid once the scheduled start has passed", () => {
    const start = new Date("2026-06-01T10:00:00.000Z");
    const before = new Date("2026-06-01T09:00:00.000Z");
    const after = new Date("2026-06-01T10:30:00.000Z");

    const allowedBefore = getAllowedTransitionsAt(
      "BOOKED",
      "RECEPTIONIST",
      start,
      before,
    );
    expect(allowedBefore).not.toContain("NO_SHOW");
    // forward transitions still permitted
    expect(allowedBefore).toContain("WAITING");

    const allowedAfter = getAllowedTransitionsAt(
      "BOOKED",
      "RECEPTIONIST",
      start,
      after,
    );
    expect(allowedAfter).toContain("NO_SHOW");
  });

  it("forward transitions remain available before the slot start", () => {
    const start = new Date("2026-06-01T10:00:00.000Z");
    const before = new Date("2026-06-01T09:30:00.000Z");
    const allowed = getAllowedTransitionsAt(
      "BOOKED",
      "RECEPTIONIST",
      start,
      before,
    );
    expect(allowed).toEqual(expect.arrayContaining(["WAITING", "IN_PROGRESS"]));
  });
});

describe("getStepStates", () => {
  it("BOOKED → first step current, rest future", () => {
    const s = getStepStates("BOOKED");
    expect(s.BOOKED).toBe("current");
    expect(s.WAITING).toBe("future");
    expect(s.IN_PROGRESS).toBe("future");
    expect(s.COMPLETED).toBe("future");
  });

  it("IN_PROGRESS → BOOKED + WAITING passed, IN_PROGRESS current, COMPLETED future", () => {
    const s = getStepStates("IN_PROGRESS");
    expect(s.BOOKED).toBe("passed");
    expect(s.WAITING).toBe("passed");
    expect(s.IN_PROGRESS).toBe("current");
    expect(s.COMPLETED).toBe("future");
  });

  it("COMPLETED → all four steps passed/current", () => {
    const s = getStepStates("COMPLETED");
    expect(s.BOOKED).toBe("passed");
    expect(s.WAITING).toBe("passed");
    expect(s.IN_PROGRESS).toBe("passed");
    expect(s.COMPLETED).toBe("current");
  });

  it("CANCELLED → every step unreachable (chain renders muted)", () => {
    const s = getStepStates("CANCELLED");
    for (const step of LIFECYCLE_STEPS) {
      expect(s[step]).toBe("unreachable");
    }
  });

  it("NO_SHOW → every step unreachable", () => {
    const s = getStepStates("NO_SHOW");
    for (const step of LIFECYCLE_STEPS) {
      expect(s[step]).toBe("unreachable");
    }
  });
});

describe("getQuickActions — reception card icon row", () => {
  const start = new Date("2026-06-01T10:00:00.000Z");
  const before = new Date("2026-06-01T09:30:00.000Z");
  const after = new Date("2026-06-01T10:30:00.000Z");

  it("RECEPTIONIST BOOKED + before slot → CONFIRM + ARRIVED (no START, no NO_SHOW yet)", () => {
    const a = getQuickActions("BOOKED", "RECEPTIONIST", start, before);
    const kinds = a.map((x) => x.kind);
    expect(kinds).toContain("CONFIRM");
    expect(kinds).toContain("ARRIVED");
    expect(kinds).not.toContain("START");
    expect(kinds).not.toContain("NO_SHOW");
  });

  it("BOOKED + after slot → adds NO_SHOW with confirm flag", () => {
    const a = getQuickActions("BOOKED", "RECEPTIONIST", start, after);
    const noShow = a.find((x) => x.kind === "NO_SHOW");
    expect(noShow).toBeDefined();
    expect(noShow?.confirm).toBe(true);
  });

  it("DOCTOR WAITING → START + NO_SHOW (when past), no ARRIVED", () => {
    const a = getQuickActions("WAITING", "DOCTOR", start, after);
    const kinds = a.map((x) => x.kind);
    expect(kinds).not.toContain("ARRIVED");
    expect(kinds).toContain("START");
    expect(kinds).toContain("NO_SHOW");
  });

  it("DOCTOR IN_PROGRESS → COMPLETE only", () => {
    const a = getQuickActions("IN_PROGRESS", "DOCTOR", start, after);
    const kinds = a.map((x) => x.kind);
    expect(kinds).toEqual(["COMPLETE"]);
  });

  it("COMPLETED → no actions (terminal)", () => {
    const a = getQuickActions("COMPLETED", "RECEPTIONIST", start, after);
    expect(a).toEqual([]);
  });

  it("NURSE never gets quick actions", () => {
    expect(getQuickActions("BOOKED", "NURSE", start, after)).toEqual([]);
    expect(getQuickActions("WAITING", "NURSE", start, after)).toEqual([]);
  });
});
