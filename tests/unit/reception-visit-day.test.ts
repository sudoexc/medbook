/**
 * Audit AP-12 / Q-05, the client and shared-rule side.
 *
 *   - The reception page fixed "today" once at mount: a tab left open
 *     overnight showed yesterday's list as today's. "Today" now follows the
 *     clock (`watchClinicDay`), and a day picked on the doctors panel holds
 *     only for the clinic day it was picked on (`panelDayFor`).
 *   - «Пришёл» / «Начать» / «Вызвать» were offered for any day. The shared
 *     transition rule (`canTransitionAt`) now refuses arrival and the call
 *     off the visit's own clinic day, so `getQuickActions` drops them, the
 *     cabinet card hides «Начать запись», and `applyWaitingIntake` refuses to
 *     hand a ticket number to another day's visit.
 *
 * Clinic time is Asia/Tashkent (UTC+5) while the server runs UTC: 19:30Z is
 * already the next day in the clinic.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  canTransitionAt,
  isOnClinicDay,
  requiresVisitDay,
} from "@/lib/appointment-transitions";
import {
  getAllowedTransitionsAt,
  getQuickActions,
} from "@/lib/appointments/lifecycle";
import {
  addTashkentDays,
  tashkentDateOf,
  tashkentDayWindow,
} from "@/lib/tashkent-time";
import {
  applyWaitingIntake,
  NotVisitDayError,
} from "@/server/appointments/intake";
import { watchClinicDay } from "@/hooks/use-clinic-today";
import {
  panelDayFor,
  pickPanelDay,
} from "@/app/[locale]/crm/reception/_hooks/panel-day";
import { resolveWindow } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-filters";
import { DoctorQueueCard } from "@/app/[locale]/crm/reception/_components/doctor-queue-card";
import type { AppointmentRow } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-list";

afterEach(() => {
  vi.useRealTimers();
});

// 2026-09-26 15:00 in the clinic.
const NOW = new Date("2026-09-26T10:00:00.000Z");
const TODAY_SLOT = new Date("2026-09-26T11:00:00.000Z");
const TOMORROW_SLOT = new Date("2026-09-27T11:00:00.000Z");

describe("Q-05: arrival and the call belong to the visit's own clinic day", () => {
  it("canTransitionAt answers not_today for WAITING / IN_PROGRESS on another day", () => {
    expect(canTransitionAt("CONFIRMED", "WAITING", TOMORROW_SLOT, NOW)).toEqual({
      ok: false,
      reason: "not_today",
    });
    expect(canTransitionAt("BOOKED", "IN_PROGRESS", TOMORROW_SLOT, NOW)).toEqual({
      ok: false,
      reason: "not_today",
    });
    expect(canTransitionAt("CONFIRMED", "WAITING", TODAY_SLOT, NOW)).toEqual({
      ok: true,
    });
  });

  it("the day is the clinic's: 00:30 in Tashkent is tomorrow even on the same UTC date", () => {
    const lateEvening = new Date("2026-09-26T18:00:00.000Z"); // 23:00 Tashkent
    const pastMidnight = new Date("2026-09-26T19:30:00.000Z"); // 00:30 on the 27th
    expect(isOnClinicDay(pastMidnight, lateEvening)).toBe(false);
    expect(canTransitionAt("CONFIRMED", "WAITING", pastMidnight, lateEvening)).toEqual({
      ok: false,
      reason: "not_today",
    });
  });

  it("only moves INTO the building are day-bound", () => {
    expect(requiresVisitDay("CONFIRMED", "WAITING")).toBe(true);
    expect(requiresVisitDay("WAITING", "IN_PROGRESS")).toBe(true);
    expect(requiresVisitDay("IN_PROGRESS", "IN_PROGRESS")).toBe(false);
    expect(requiresVisitDay("IN_PROGRESS", "COMPLETED")).toBe(false);
    expect(requiresVisitDay("BOOKED", "CANCELLED")).toBe(false);
    expect(requiresVisitDay("BOOKED", "CONFIRMED")).toBe(false);
  });

  it("tomorrow's booking keeps cancel and confirm, loses arrival and start", () => {
    const allowed = getAllowedTransitionsAt(
      "CONFIRMED",
      "RECEPTIONIST",
      TOMORROW_SLOT,
      NOW,
    );
    expect(allowed).not.toContain("WAITING");
    expect(allowed).not.toContain("IN_PROGRESS");
    expect(allowed).toContain("CANCELLED");
    expect(allowed).toContain("BOOKED");
  });

  it("the panel row of tomorrow's booking has no «Пришёл»; today's does", () => {
    const tomorrowKinds = getQuickActions(
      "CONFIRMED",
      "RECEPTIONIST",
      TOMORROW_SLOT,
      NOW,
    ).map((a) => a.kind);
    expect(tomorrowKinds).not.toContain("ARRIVED");

    const todayKinds = getQuickActions(
      "CONFIRMED",
      "RECEPTIONIST",
      TODAY_SLOT,
      NOW,
    ).map((a) => a.kind);
    expect(todayKinds).toContain("ARRIVED");
  });

  it("applyWaitingIntake refuses another day's visit before touching the counter", async () => {
    const aggregate = vi.fn(async () => ({ _max: { queueOrder: 0, ticketSeq: 0 } }));
    const tx = { appointment: { aggregate } } as never;
    const snapshot = {
      clinicId: "c1",
      doctorId: "doc_1",
      queueStatus: "CONFIRMED",
      queueOrder: null,
      queuedAt: null,
      date: TOMORROW_SLOT,
    };

    await expect(applyWaitingIntake(tx, snapshot, NOW)).rejects.toBeInstanceOf(
      NotVisitDayError,
    );
    expect(aggregate).not.toHaveBeenCalled();

    await expect(
      applyWaitingIntake(tx, { ...snapshot, date: TODAY_SLOT }, NOW),
    ).resolves.toMatchObject({ queueOrder: 1, ticketSeq: 1, queuedAt: NOW });
  });
});

describe("AP-12: the clinic day follows the clock", () => {
  it("day arithmetic crosses months and years on Tashkent dates", () => {
    expect(addTashkentDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addTashkentDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addTashkentDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(tashkentDateOf(new Date("2026-09-26T19:30:00.000Z"))).toBe("2026-09-27");
  });

  it("a day window spans Tashkent midnight to its last millisecond", () => {
    const { from, to } = tashkentDayWindow("2026-09-27");
    expect(from.toISOString()).toBe("2026-09-26T19:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-27T18:59:59.999Z");
  });

  it("a tab open before midnight reports the new day after 00:00, no reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T18:59:50.000Z")); // 23:59:50 Tashkent
    const win = Object.assign(new EventTarget(), {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: number) => clearInterval(id),
    });
    const doc = Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    });
    const days: string[] = [];

    const stop = watchClinicDay((d) => days.push(d), {
      win: win as never,
      doc: doc as never,
    });
    vi.advanceTimersByTime(30_000);
    expect(days.at(-1)).toBe("2026-09-27");

    // A laptop waking up: the tab coming back re-reads the day at once.
    vi.setSystemTime(new Date("2026-09-27T19:05:00.000Z")); // 00:05 on the 28th
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(days.at(-1)).toBe("2026-09-28");

    stop();
    const before = days.length;
    vi.advanceTimersByTime(120_000);
    expect(days.length).toBe(before);
  });

  it("a day picked on the panel holds for that clinic day only", () => {
    const pick = pickPanelDay("2026-09-27", "2026-09-26");
    expect(panelDayFor(pick, "2026-09-26")).toBe("2026-09-27");
    // Next morning the panel is back on today, not pinned to the old pick.
    expect(panelDayFor(pick, "2026-09-27")).toBe("2026-09-27");
    expect(panelDayFor(pick, "2026-09-28")).toBe("2026-09-28");
    // Picking today means "follow the clock".
    expect(pickPanelDay("2026-09-26", "2026-09-26")).toBeNull();
    expect(panelDayFor(null, "2026-09-28")).toBe("2026-09-28");
  });

  it("the appointments page «Сегодня» window moves with the day it is given", () => {
    const monday = resolveWindow({ dateMode: "today" }, "2026-09-26");
    const tuesday = resolveWindow({ dateMode: "today" }, "2026-09-27");
    expect(monday.from).toBe("2026-09-25T19:00:00.000Z");
    expect(tuesday.from).toBe("2026-09-26T19:00:00.000Z");
    expect(resolveWindow({ dateMode: "tomorrow" }, "2026-09-26").from).toBe(
      "2026-09-26T19:00:00.000Z",
    );
  });
});

describe("AP-12: the cabinet card offers «Начать запись» only for today", () => {
  function row(id: string, date: Date, over: Partial<AppointmentRow> = {}) {
    return {
      id,
      date: date.toISOString(),
      endDate: new Date(date.getTime() + 30 * 60_000).toISOString(),
      status: "CONFIRMED",
      queueStatus: "CONFIRMED",
      channel: "PHONE",
      durationMin: 30,
      startedAt: null,
      queueOrder: null,
      queuedAt: null,
      queuePriority: 0,
      cabinet: { number: "5" },
      patient: { id: `p_${id}`, fullName: `Пациент ${id}` },
      doctor: { id: "doc_1", nameRu: "Султанов", nameUz: "Sultanov" },
      ...over,
    } as unknown as AppointmentRow;
  }

  const doctor = {
    id: "doc_1",
    nameRu: "Султанов Азиз",
    nameUz: "Sultanov Aziz",
    photoUrl: null,
    color: null,
    specializationRu: "Невролог",
    specializationUz: "Nevrolog",
    isActive: true,
  };

  function card(appointments: AppointmentRow[], clinicToday: string) {
    return renderToStaticMarkup(
      React.createElement(DoctorQueueCard, {
        index: 1,
        doctor,
        appointments,
        clinicToday,
        onRowClick: () => {},
      }),
    );
  }

  it("tomorrow's booking is listed without a start button", () => {
    const html = card([row("b1", TOMORROW_SLOT)], "2026-09-26");
    expect(html).toContain("Пациент b1");
    expect(html).not.toContain("reception.doctorQueue.startBooking");
  });

  it("today's booking keeps it", () => {
    const html = card([row("b1", TODAY_SLOT)], "2026-09-26");
    expect(html).toContain("reception.doctorQueue.startBooking");
  });

  it("the call button stays disabled when the queue head is not today's", () => {
    const html = card(
      [
        row("w1", new Date("2026-09-25T06:00:00.000Z"), {
          channel: "WALKIN",
          status: "WAITING",
          queueStatus: "WAITING",
          queueOrder: 1,
          queuedAt: "2026-09-25T06:00:00.000Z",
        } as Partial<AppointmentRow>),
      ],
      "2026-09-26",
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>reception\.doctorQueue\.callNextLive/);

    const today = card(
      [
        row("w2", TODAY_SLOT, {
          channel: "WALKIN",
          status: "WAITING",
          queueStatus: "WAITING",
          queueOrder: 1,
          queuedAt: TODAY_SLOT.toISOString(),
        } as Partial<AppointmentRow>),
      ],
      "2026-09-26",
    );
    expect(today).toContain("reception.doctorQueue.callNextLive");
    expect(today).not.toMatch(
      /<button[^>]*disabled=""[^>]*>reception\.doctorQueue\.callNextLive/,
    );
  });
});
