/**
 * Audit DR-05: «Быстрая запись к врачу» on the Doctors page was a mock.
 *
 * Services and times were hard-coded, and «Создать запись» called an
 * `onCreate` the page never passed: the click did nothing, with no toast and
 * no error, and the desk could tell the patient «вы записаны». The widget is
 * now a shortcut into the one booking path: the button opens
 * `NewAppointmentDialog` with the chosen doctor and day, where the patient,
 * the doctor's real services and the free slots are picked and the booking
 * is created like everywhere else.
 *
 * The widget is driven through a minimal hook runtime (the unit suite has no
 * DOM): render, press the controls through their props, render again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const r = {
    states: [] as unknown[],
    idx: 0,
    useState<T>(init: T | (() => T)) {
      const i = r.idx++;
      if (!(i in r.states)) {
        r.states[i] = typeof init === "function" ? (init as () => T)() : init;
      }
      const set = (v: T | ((p: T) => T)) => {
        r.states[i] =
          typeof v === "function" ? (v as (p: T) => T)(r.states[i] as T) : v;
      };
      return [r.states[i] as T, set] as const;
    },
    useMemo<T>(fn: () => T) {
      return fn();
    },
  };
  return r;
});

vi.mock("react", () => ({
  useState: runtime.useState,
  useMemo: runtime.useMemo,
}));
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => (key: string) => key,
}));
// Host-element stand-ins: the test reads their props, nothing renders.
vi.mock("@/components/ui/select", () => ({
  Select: "Select",
  SelectContent: "SelectContent",
  SelectItem: "SelectItem",
  SelectTrigger: "SelectTrigger",
  SelectValue: "SelectValue",
}));
vi.mock("@/components/ui/input", () => ({ Input: "Input" }));
vi.mock("@/components/ui/button", () => ({ Button: "Button" }));
vi.mock("@/components/appointments/NewAppointmentDialog", () => ({
  NewAppointmentDialog: "NewAppointmentDialog",
}));
vi.mock("@/lib/tashkent-time", () => ({ tashkentToday: () => "2026-09-28" }));

import {
  DoctorsQuickBook,
  quickBookSeed,
} from "@/app/[locale]/crm/doctors/_components/doctors-quick-book";

type El = { type: unknown; props: Record<string, unknown> };

function find(node: unknown, type: string): El[] {
  const out: El[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object" || !("props" in n)) return;
    const el = n as El;
    if (el.type === type) out.push(el);
    walk(el.props.children);
  };
  walk(node);
  return out;
}

const doctors = [
  { id: "doc_aziz", nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz", isActive: true },
  { id: "doc_old", nameRu: "Уволен", nameUz: "Ketgan", isActive: false },
] as never;

function render() {
  runtime.idx = 0;
  return DoctorsQuickBook({ doctors });
}

/** What the date input reports as the desk types into it. */
function type(value: string, tree: unknown) {
  (find(tree, "Input")[0].props.onChange as (e: unknown) => void)({
    target: { value },
  });
}

function textOf(tree: unknown): string {
  return JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v));
}

beforeEach(() => {
  runtime.states = [];
});

describe("DR-05 — quick booking opens the real booking dialog", () => {
  it("«Создать запись» opens NewAppointmentDialog with the chosen doctor and day", () => {
    let tree = render();
    // Nothing chosen yet: the button waits, the dialog is closed.
    expect(find(tree, "Button")[0].props.disabled).toBe(true);
    expect(find(tree, "NewAppointmentDialog")[0].props.open).toBe(false);

    (find(tree, "Select")[0].props.onValueChange as (v: string) => void)("doc_aziz");
    tree = render();
    (find(tree, "Input")[0].props.onChange as (e: unknown) => void)({
      target: { value: "2026-10-02" },
    });
    tree = render();
    const button = find(tree, "Button")[0];
    expect(button.props.disabled).toBe(false);
    (button.props.onClick as () => void)();

    tree = render();
    const dialog = find(tree, "NewAppointmentDialog")[0].props;
    expect(dialog.open).toBe(true);
    expect(dialog.initialDoctorId).toBe("doc_aziz");
    const day = dialog.initialDate as Date;
    expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 10, 2]);
  });

  it("closing the dialog closes it", () => {
    let tree = render();
    (find(tree, "Select")[0].props.onValueChange as (v: string) => void)("doc_aziz");
    tree = render();
    (find(tree, "Button")[0].props.onClick as () => void)();
    tree = render();
    (find(tree, "NewAppointmentDialog")[0].props.onOpenChange as (v: boolean) => void)(false);
    tree = render();
    expect(find(tree, "NewAppointmentDialog")[0].props.open).toBe(false);
  });

  it("offers no hard-coded services or times, and only active doctors", () => {
    const tree = render();
    const items = find(tree, "SelectItem").map((el) => el.props.value);
    expect(items).toEqual(["doc_aziz"]);
    const text = JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v));
    expect(text).not.toContain("serviceConsult");
    expect(text).not.toContain("09:00");
    expect(text).not.toContain("onCreate");
  });

  it("the day starts at today, with the calendar greyed before it (AP-09)", () => {
    const tree = render();
    const input = find(tree, "Input")[0];
    expect(input.props.min).toBe("2026-09-28");
    expect(input.props.value).toBe("2026-09-28");
    expect(textOf(tree)).not.toContain("pastDate");
  });

  it("05.10 typed over 28.09 lands on 05.10, through the 05.09 Chrome passes on the way", () => {
    let tree = render();
    (find(tree, "Select")[0].props.onValueChange as (v: string) => void)("doc_aziz");
    tree = render();
    // Day segment «05»: the input commits 2026-09-05, behind today. The step
    // must stay, or the controlled value snaps back to 28.09 and the month
    // then lands on 28.10.
    type("2026-09-05", tree);
    tree = render();
    expect(find(tree, "Input")[0].props.value).toBe("2026-09-05");
    expect(textOf(tree)).toContain("pastDate");
    // Month segment «10».
    type("2026-10-05", tree);
    tree = render();
    expect(find(tree, "Input")[0].props.value).toBe("2026-10-05");
    expect(textOf(tree)).not.toContain("pastDate");

    (find(tree, "Button")[0].props.onClick as () => void)();
    tree = render();
    const day = find(tree, "NewAppointmentDialog")[0].props.initialDate as Date;
    expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 10, 5]);
  });

  it("a past day left in the field is flagged and the dialog opens on today", () => {
    let tree = render();
    (find(tree, "Select")[0].props.onValueChange as (v: string) => void)("doc_aziz");
    tree = render();
    type("2026-08-23", tree);
    tree = render();
    const input = find(tree, "Input")[0];
    expect(input.props.value).toBe("2026-08-23");
    expect(input.props["aria-invalid"]).toBe(true);
    expect(textOf(tree)).toContain("pastDate");
    // Not a hard refusal: the button still opens the booking, on today.
    expect(find(tree, "Button")[0].props.disabled).toBe(false);
    (find(tree, "Button")[0].props.onClick as () => void)();
    tree = render();
    const day = find(tree, "NewAppointmentDialog")[0].props.initialDate as Date;
    expect([day.getFullYear(), day.getMonth() + 1, day.getDate()]).toEqual([2026, 9, 28]);
  });

  it("a cleared segment empties the day and holds the button until it is complete", () => {
    let tree = render();
    (find(tree, "Select")[0].props.onValueChange as (v: string) => void)("doc_aziz");
    tree = render();
    type("", tree);
    tree = render();
    expect(find(tree, "Input")[0].props.value).toBe("");
    expect(find(tree, "Button")[0].props.disabled).toBe(true);
    expect(textOf(tree)).not.toContain("pastDate");
  });

  it("the seed never carries a past day into the dialog", () => {
    const seed = quickBookSeed("doc_aziz", "2026-08-23", "2026-09-28");
    expect(seed.initialDoctorId).toBe("doc_aziz");
    expect(seed.initialDate.getDate()).toBe(28);
    expect(seed.initialDate.getMonth() + 1).toBe(9);
  });
});
