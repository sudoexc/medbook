/**
 * AP-09 review: a date typed on the keyboard into the slot picker must land
 * on the day that was typed.
 *
 * Chrome commits a typed date segment by segment. With 28.09 in the field,
 * typing 05.10 day first (the ru format) passes through 05.09, a day behind
 * today. The picker used to refuse that step and jump any past value to
 * today, so the controlled input snapped back to 28.09 and the month then
 * made it 28.10: the wrong day, with no message, on the field most phone
 * bookings go through (NewAppointmentDialog, the drawer, the Doctors quick
 * book). Every typed value now reaches the parent; a past one is flagged and
 * offers no slots, and the server still answers in_past. Only a past day
 * handed in from outside (a past calendar slot, yesterday's booking in the
 * drawer) opens on today.
 *
 * The picker is driven through a minimal hook runtime (the unit suite has no
 * DOM), with the parent's date state played by the harness.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  type Effect = { deps?: unknown[]; cleanup?: () => void };
  const r = {
    refs: [] as Array<{ current: unknown }>,
    effects: [] as Effect[],
    refIdx: 0,
    effectIdx: 0,
    pending: [] as Array<() => void>,
    useRef<T>(init: T) {
      const i = r.refIdx++;
      if (!(i in r.refs)) r.refs[i] = { current: init };
      return r.refs[i] as { current: T };
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
      r.refs = [];
      r.effects = [];
      r.pending = [];
    },
  };
  return r;
});

const queries = vi.hoisted(() => ({ calls: [] as Array<{ enabled?: boolean }> }));

vi.mock("react", () => ({
  useRef: runtime.useRef,
  useEffect: runtime.useEffect,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { enabled?: boolean }) => {
    queries.calls.push(opts);
    return opts.enabled
      ? { data: { slots: ["10:00", "10:20"], slotMin: 20 }, isLoading: false, isError: false }
      : { data: undefined, isLoading: false, isError: false };
  },
}));
// Host-element stand-ins: the test reads their props, nothing renders.
vi.mock("@/components/ui/input", () => ({ Input: "Input" }));
vi.mock("@/components/ui/label", () => ({ Label: "Label" }));
vi.mock("@/lib/tashkent-time", () => ({ tashkentToday: () => "2026-09-28" }));

import { SlotPicker } from "@/components/appointments/SlotPicker";

type El = { type: unknown; props: Record<string, unknown> };

function find(node: unknown, pred: (el: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object" || !("props" in n)) return;
    const el = n as El;
    if (pred(el)) out.push(el);
    walk(el.props.children);
  };
  walk(node);
  return out;
}

function textOf(tree: unknown): string {
  return JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v));
}

function ymd(d: Date): string {
  return [
    String(d.getFullYear()).padStart(4, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Mount the picker under a parent that keeps the date in state, the way
 * NewAppointmentDialog and the drawer do. Effects run after each render and
 * a date change from an effect renders again, as React would.
 */
function mount(initial: Date, doctorId: string | null = "doc_aziz") {
  let date = initial;
  let tree: unknown = null;
  let dirty = false;
  const onDateChange = (d: Date) => {
    date = d;
    dirty = true;
  };
  const render = () => {
    for (let guard = 0; guard < 10; guard++) {
      dirty = false;
      runtime.refIdx = 0;
      runtime.effectIdx = 0;
      tree = SlotPicker({
        doctorId,
        date,
        serviceIds: [],
        value: null,
        onChange: () => {},
        onDateChange,
      });
      for (const run of runtime.pending.splice(0)) run();
      if (!dirty) return;
    }
    throw new Error("render loop");
  };
  render();
  const input = () => find(tree, (el) => el.type === "Input")[0]!;
  return {
    get date() {
      return ymd(date);
    },
    get tree() {
      return tree;
    },
    input,
    /** What the date input reports as the desk types into it. */
    type(value: string) {
      (input().props.onChange as (e: unknown) => void)({ target: { value } });
      render();
    },
    slots: () =>
      find(tree, (el) => el.type === "button").map((el) => el.props.children),
  };
}

afterEach(() => {
  runtime.reset();
  queries.calls = [];
});

describe("SlotPicker keeps the day the desk typed (AP-09 review)", () => {
  it("05.10 typed over 28.09 lands on 05.10, through the 05.09 Chrome passes on the way", () => {
    const picker = mount(new Date(2026, 8, 28));
    expect(picker.input().props.min).toBe("2026-09-28");
    expect(picker.input().props.value).toBe("2026-09-28");

    picker.type("2026-09-05"); // day segment «05»
    expect(picker.date).toBe("2026-09-05");
    expect(picker.input().props.value).toBe("2026-09-05");

    picker.type("2026-10-05"); // month segment «10»
    expect(picker.date).toBe("2026-10-05");
    expect(picker.input().props.value).toBe("2026-10-05");
    expect(textOf(picker.tree)).not.toContain("pastDate");
    expect(picker.slots()).toEqual(["10:00", "10:20"]);
  });

  it("a past day left in the field is flagged and offers no slot to pick", () => {
    const picker = mount(new Date(2026, 8, 28));
    picker.type("2026-08-23");
    expect(picker.date).toBe("2026-08-23");
    expect(picker.input().props["aria-invalid"]).toBe(true);
    expect(textOf(picker.tree)).toContain("pastDate");
    expect(textOf(picker.tree)).not.toContain("noSlots");
    expect(picker.slots()).toEqual([]);
    // No slot request goes out for a past day.
    expect(queries.calls.at(-1)?.enabled).toBe(false);
  });

  it("a year typed digit by digit survives the round trip through the parent", () => {
    const picker = mount(new Date(2026, 8, 28));
    for (const step of ["0002-10-05", "0020-10-05", "0202-10-05", "2027-10-05"]) {
      picker.type(step);
      expect(picker.input().props.value).toBe(step);
    }
    expect(picker.date).toBe("2027-10-05");
  });

  it("an empty value (a segment being cleared) leaves the day alone", () => {
    const picker = mount(new Date(2026, 9, 5));
    picker.type("");
    expect(picker.date).toBe("2026-10-05");
  });

  it("a past day handed in from outside opens on today", () => {
    // A past slot clicked in the calendar, yesterday's booking in the drawer.
    const picker = mount(new Date(2026, 8, 27));
    expect(picker.date).toBe("2026-09-28");
    expect(textOf(picker.tree)).not.toContain("pastDate");
  });

  it("today and later days handed in from outside are kept", () => {
    expect(mount(new Date(2026, 8, 28)).date).toBe("2026-09-28");
    runtime.reset();
    expect(mount(new Date(2026, 10, 2)).date).toBe("2026-11-02");
  });
});
