/**
 * «Текущий пациент» hero-card spec — the third member of the two-lanes
 * invariant family (see queue-ordering.test.ts, reorder-queue-signal.test.ts).
 *
 *   C1 — the IN_PROGRESS visit always wins, from either lane, no matter how
 *        many earlier-dated WAITING rows sit in front of it. This is the
 *        regression that shipped: walk-ins carry `date = now` at registration,
 *        so a date-ASC `find(IN_PROGRESS || WAITING)` handed the card to a
 *        queued walk-in and «Начать приём» force-completed the real visit.
 *   C2 — a WAITING row only reaches the card once it has been CALLED; plain
 *        queued patients belong to the live queue / schedule.
 *   C3 — the imminent-booking fallback is booked-lane only and flags itself
 *        as implicit, so the card can say «Следующая запись».
 */
import { describe, expect, it } from "vitest";

import {
  pickCurrentVisit,
  LATE_ARRIVAL_GRACE_MS,
  type CurrentVisitCandidate,
} from "@/lib/doctor-current-visit";

const NOW = new Date("2026-08-19T10:00:00.000Z");
const MIN = 60_000;

function row(
  id: string,
  over: Partial<CurrentVisitCandidate> = {},
): CurrentVisitCandidate & { id: string } {
  return {
    id,
    status: "BOOKED",
    calledAt: null,
    channel: "TELEGRAM",
    date: NOW,
    ...over,
  };
}

/** Rows arrive from Prisma sorted by date ASC — mirror that in every case. */
function byDate<T extends CurrentVisitCandidate>(...rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
}

describe("pickCurrentVisit — C1: the running visit wins", () => {
  it("prefers IN_PROGRESS over an earlier-dated walk-in in the queue", () => {
    // The exact shipped bug: walk-in registered 09:30 (date=now at register),
    // booked visit started at 10:00 and is underway.
    const walkin = row("walkin", {
      status: "WAITING",
      channel: "WALKIN",
      date: new Date(NOW.getTime() - 30 * MIN),
    });
    const running = row("running", {
      status: "IN_PROGRESS",
      date: NOW,
    });

    const pick = pickCurrentVisit(byDate(walkin, running), NOW);

    expect(pick?.row.id).toBe("running");
    expect(pick?.isImplicitNext).toBe(false);
  });

  it("prefers IN_PROGRESS over an earlier-dated CALLED booking", () => {
    const called = row("called", {
      status: "WAITING",
      calledAt: new Date(NOW.getTime() - 5 * MIN),
      date: new Date(NOW.getTime() - 45 * MIN),
    });
    const running = row("running", { status: "IN_PROGRESS" });

    expect(pickCurrentVisit(byDate(called, running), NOW)?.row.id).toBe(
      "running",
    );
  });

  it("keeps a walk-in that is being seen — the running lane is not filtered", () => {
    const running = row("walkin-running", {
      status: "IN_PROGRESS",
      channel: "WALKIN",
    });

    expect(pickCurrentVisit([running], NOW)?.row.id).toBe("walkin-running");
  });
});

describe("pickCurrentVisit — C2: WAITING needs a call", () => {
  it("ignores un-called WAITING rows entirely", () => {
    const queued = row("queued", { status: "WAITING", channel: "WALKIN" });

    expect(pickCurrentVisit([queued], NOW)).toBeNull();
  });

  it("takes a CALLED patient when nothing is running", () => {
    const queued = row("queued", {
      status: "WAITING",
      channel: "WALKIN",
      date: new Date(NOW.getTime() - 20 * MIN),
    });
    const called = row("called", {
      status: "WAITING",
      calledAt: new Date(NOW.getTime() - MIN),
      date: new Date(NOW.getTime() - 10 * MIN),
    });

    const pick = pickCurrentVisit(byDate(queued, called), NOW);

    expect(pick?.row.id).toBe("called");
    expect(pick?.isImplicitNext).toBe(false);
  });
});

describe("pickCurrentVisit — C3: imminent-booking fallback", () => {
  it("surfaces a booking due within the window, flagged implicit", () => {
    const soon = row("soon", { date: new Date(NOW.getTime() + 10 * MIN) });

    const pick = pickCurrentVisit([soon], NOW);

    expect(pick?.row.id).toBe("soon");
    expect(pick?.isImplicitNext).toBe(true);
  });

  it("accepts CONFIRMED too — CRM bookings auto-confirm", () => {
    const soon = row("soon", {
      status: "CONFIRMED",
      date: new Date(NOW.getTime() + 5 * MIN),
    });

    expect(pickCurrentVisit([soon], NOW)?.row.id).toBe("soon");
  });

  it("never falls back to a walk-in", () => {
    const walkinSoon = row("walkin-soon", {
      channel: "WALKIN",
      date: new Date(NOW.getTime() + 5 * MIN),
    });

    expect(pickCurrentVisit([walkinSoon], NOW)).toBeNull();
  });

  it("ignores bookings beyond the future window", () => {
    const far = row("far", { date: new Date(NOW.getTime() + 60 * MIN) });

    expect(pickCurrentVisit([far], NOW)).toBeNull();
  });

  it("keeps a slightly-late booking within the grace window", () => {
    // The regression this guards: at ms >= 0 a patient 5 minutes late fell
    // off the card, hiding the «Начать» CTA exactly when the doctor needed
    // it. Late bookings stay up until LATE_ARRIVAL_GRACE_MS elapses (or the
    // row is cancelled / marked no-show).
    const late = row("late", { date: new Date(NOW.getTime() - 5 * MIN) });

    const pick = pickCurrentVisit([late], NOW);

    expect(pick?.row.id).toBe("late");
    expect(pick?.isImplicitNext).toBe(true);
  });

  it("drops a booking once the late-arrival grace has fully elapsed", () => {
    const tooLate = row("too-late", {
      date: new Date(NOW.getTime() - LATE_ARRIVAL_GRACE_MS - MIN),
    });

    expect(pickCurrentVisit([tooLate], NOW)).toBeNull();
  });

  it("prefers the most overdue booking over a future imminent one", () => {
    // date-ASC + find: the earliest still-eligible row is "next to be seen".
    // The doctor clears it explicitly (start / no-show / cancel) before the
    // following booking claims the card.
    const late = row("late", { date: new Date(NOW.getTime() - 5 * MIN) });
    const soon = row("soon", { date: new Date(NOW.getTime() + 10 * MIN) });

    expect(pickCurrentVisit(byDate(late, soon), NOW)?.row.id).toBe("late");
  });

  it("yields to a called patient rather than the sooner booking", () => {
    const soon = row("soon", { date: new Date(NOW.getTime() + 2 * MIN) });
    const called = row("called", {
      status: "WAITING",
      calledAt: NOW,
      date: new Date(NOW.getTime() - 15 * MIN),
    });

    const pick = pickCurrentVisit(byDate(called, soon), NOW);

    expect(pick?.row.id).toBe("called");
    expect(pick?.isImplicitNext).toBe(false);
  });
});

describe("pickCurrentVisit — closed days", () => {
  it("returns null when the day holds only finished/absent visits", () => {
    const done = row("done", { status: "COMPLETED" });
    const noShow = row("no-show", { status: "NO_SHOW" });
    const cancelled = row("cancelled", { status: "CANCELLED" });

    expect(pickCurrentVisit(byDate(done, noShow, cancelled), NOW)).toBeNull();
  });

  it("returns null on an empty day", () => {
    expect(pickCurrentVisit([], NOW)).toBeNull();
  });
});
