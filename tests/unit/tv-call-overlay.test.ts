import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit Q-02: on the shared /tv board the green «Пройдите в кабинет»
 * takeover never went away. Its 15 s timer lived in an effect that also
 * depended on the board snapshot; the board refetch every call triggers
 * re-ran that effect, the cleanup cleared the timer, and the re-run bailed on
 * «seq already seen» without arming a new one.
 *
 * The auto-dismiss now depends on the call's seq alone. This suite drives the
 * real hook through a minimal hook runtime (the unit suite has no DOM).
 */

const runtime = vi.hoisted(() => {
  type Effect = { deps?: unknown[]; cleanup?: () => void };
  const r = {
    states: [] as unknown[],
    effects: [] as Effect[],
    stateIdx: 0,
    effectIdx: 0,
    pending: [] as Array<() => void>,
    rerender: null as null | (() => void),
    useState<T>(init: T | (() => T)) {
      const i = r.stateIdx++;
      if (!(i in r.states)) {
        r.states[i] = typeof init === "function" ? (init as () => T)() : init;
      }
      const set = (v: T | ((prev: T) => T)) => {
        const next =
          typeof v === "function" ? (v as (p: T) => T)(r.states[i] as T) : v;
        if (Object.is(next, r.states[i])) return;
        r.states[i] = next;
        r.rerender?.();
      };
      return [r.states[i] as T, set] as const;
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const i = r.effectIdx++;
      const prev = r.effects[i];
      const changed =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, k) => !Object.is(d, prev.deps![k]));
      if (!changed) return;
      r.pending.push(() => {
        prev?.cleanup?.();
        const cleanup = fn();
        r.effects[i] = {
          deps,
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
        };
      });
    },
    reset() {
      for (const e of r.effects) e?.cleanup?.();
      r.states = [];
      r.effects = [];
      r.pending = [];
      r.rerender = null;
    },
  };
  return r;
});

vi.mock("react", () => ({
  useState: runtime.useState,
  useEffect: runtime.useEffect,
}));

import {
  CALL_OVERLAY_MS,
  isCallOverlayOpen,
  useCallOverlayOpen,
} from "@/hooks/use-call-overlay";

// Called through a plain binding: the harness below plays React's role.
const overlayHook = useCallOverlayOpen;

/** Render `useCallOverlayOpen(seq)`; returns the latest value + a rerender. */
function renderOverlay(initialSeq: number | null) {
  let seq = initialSeq;
  let value = false;
  const render = () => {
    runtime.stateIdx = 0;
    runtime.effectIdx = 0;
    value = overlayHook(seq);
    const effects = runtime.pending.splice(0);
    for (const run of effects) run();
  };
  runtime.rerender = render;
  render();
  return {
    get open() {
      return value;
    },
    rerender(nextSeq: number | null = seq) {
      seq = nextSeq;
      render();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  runtime.reset();
  vi.useRealTimers();
});

describe("TV call takeover auto-dismiss", () => {
  it("closes 15 s after the call even though the board refreshes while it shows", () => {
    const view = renderOverlay(null);
    expect(view.open).toBe(false);

    view.rerender(1); // queue.called
    expect(view.open).toBe(true);

    // The call pokes a board refetch 400 ms later, and more updates keep
    // arriving: each is a re-render with the same call.
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(400);
      view.rerender(1);
      expect(view.open).toBe(true);
    }

    vi.advanceTimersByTime(CALL_OVERLAY_MS - 4_000);
    expect(view.open).toBe(false);
  });

  it("a board refresh does not restart the countdown", () => {
    const view = renderOverlay(1);
    vi.advanceTimersByTime(CALL_OVERLAY_MS - 100);
    view.rerender(1);
    vi.advanceTimersByTime(100);
    expect(view.open).toBe(false);
  });

  it("the next call opens it again and gets its own 15 s", () => {
    const view = renderOverlay(1);
    vi.advanceTimersByTime(CALL_OVERLAY_MS);
    expect(view.open).toBe(false);

    view.rerender(2);
    expect(view.open).toBe(true);
    vi.advanceTimersByTime(CALL_OVERLAY_MS - 1);
    expect(view.open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(view.open).toBe(false);
  });

  it("the pure rule: open only for a call whose seq was not dismissed", () => {
    expect(isCallOverlayOpen(null, 0)).toBe(false);
    expect(isCallOverlayOpen(3, 0)).toBe(true);
    expect(isCallOverlayOpen(3, 3)).toBe(false);
    expect(isCallOverlayOpen(4, 3)).toBe(true);
  });
});

describe("the shared /tv board", () => {
  it("derives its takeover from the seq-keyed hook, not from a timer beside the board snapshot", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../src/app/tv/page.tsx"),
      "utf8",
    );
    expect(src).toContain("useCallOverlayOpen(call?.seq)");
    expect(src).not.toMatch(/setOverlay\(/);
  });
});
