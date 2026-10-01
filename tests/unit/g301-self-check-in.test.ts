/**
 * Audit G3-01 — «Я на месте» from the Mini App set `arrivedAt` and showed a
 * four-second toast on the reception page only. No list, card or API showed
 * it; the patient waited in the hall and an hour later got «вы не пришли».
 * (The sweep side is pinned in no-show-sweep-queue-status.test.ts, the
 * staff moves and the Mini App tap in g301-check-in-day.test.ts.)
 *
 * Pinned:
 *   1. One rule: checked in and not yet «Пришёл».
 *   2. The badge renders on such a booking and on nothing else, and sits on
 *      every reception list and the appointment card.
 *   3. The alert lives in the CRM layout, stays until someone reacts, and
 *      goes when the visit moves on; the reception page no longer toasts.
 *   4. Review: a check-in counts only on the visit's own clinic day, and a
 *      staff move to another day drops it.
 *   5. Review: reception's task for an unanswered check-in goes with the
 *      visit («Пришёл», «Не пришёл», a cancel, or a move off the day).
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}(${Object.values(vars).join(",")})` : `${ns}.${key}`,
  useLocale: () => "ru",
}));

import {
  awaitsDeskCheckIn,
  checkInResetOnMove,
  checkedInOnVisitDay,
  deskHasReacted,
} from "@/lib/appointments/self-check-in";
import { SelfCheckInBadge } from "@/components/atoms/self-check-in-badge";
import {
  retireMootRiskActions,
  retireVisitRiskActions,
} from "@/server/actions/in-clinic";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// 14:05 in Tashkent.
const CHECKED_IN = "2026-10-01T09:05:00.000Z";
// The 14:00 visit it was made for.
const VISIT = "2026-10-01T09:00:00.000Z";

describe("G3-01: checked in, not yet met", () => {
  it("a booking with a check-in awaits the desk", () => {
    expect(awaitsDeskCheckIn({ arrivedAt: CHECKED_IN, date: VISIT, status: "BOOKED" })).toBe(
      true,
    );
    expect(
      awaitsDeskCheckIn({
        arrivedAt: CHECKED_IN,
        date: VISIT,
        status: "CONFIRMED",
        queueStatus: "CONFIRMED",
      }),
    ).toBe(true);
  });

  it("not once «Пришёл» is pressed, nor without a check-in", () => {
    expect(
      awaitsDeskCheckIn({
        arrivedAt: CHECKED_IN,
        date: VISIT,
        status: "CONFIRMED",
        queueStatus: "WAITING",
      }),
    ).toBe(false);
    expect(
      awaitsDeskCheckIn({ arrivedAt: CHECKED_IN, date: VISIT, status: "IN_PROGRESS" }),
    ).toBe(false);
    expect(awaitsDeskCheckIn({ arrivedAt: null, date: VISIT, status: "BOOKED" })).toBe(false);
  });

  it("the desk has reacted once the visit leaves the pre-arrival states", () => {
    for (const s of ["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
      expect(deskHasReacted(s)).toBe(true);
    }
    expect(deskHasReacted("CONFIRMED")).toBe(false);
    expect(deskHasReacted(undefined)).toBe(false);
  });
});

describe("G3-01: the badge", () => {
  it("names the check-in with its Tashkent time", () => {
    const out = renderToStaticMarkup(
      React.createElement(SelfCheckInBadge, {
        row: {
          arrivedAt: CHECKED_IN,
          date: VISIT,
          status: "CONFIRMED",
          queueStatus: "CONFIRMED",
        },
      }),
    );
    expect(out).toContain("reception.live.selfCheckInBadgeAt(14:05)");
  });

  it("renders nothing for a patient already marked arrived", () => {
    const out = renderToStaticMarkup(
      React.createElement(SelfCheckInBadge, {
        row: { arrivedAt: CHECKED_IN, date: VISIT, status: "CONFIRMED", queueStatus: "WAITING" },
      }),
    );
    expect(out).toBe("");
  });

  it.each([
    "src/app/[locale]/crm/reception/_components/doctor-queue-panel.tsx",
    "src/app/[locale]/crm/reception/_components/queue-column.tsx",
    "src/app/[locale]/crm/reception/_components/reception-list-drawer.tsx",
    "src/app/[locale]/crm/appointments/_components/appointments-table.tsx",
    "src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx",
  ])("is on %s", (path) => {
    expect(read(path)).toContain("<SelfCheckInBadge row=");
  });

  it("the list row type carries arrivedAt", () => {
    expect(read("src/app/[locale]/crm/appointments/_hooks/use-appointments-list.ts")).toContain(
      "arrivedAt?: string | null;",
    );
  });
});

describe("G3-01: the alert stays until someone reacts", () => {
  it("is mounted in the CRM layout for the desk roles", () => {
    const layout = read("src/app/[locale]/crm/layout.tsx");
    expect(layout).toContain("<GlobalArrivalAlerts");
  });

  it("does not time out and goes when the visit moves on", () => {
    const src = read("src/components/layout/global-arrival-alerts.tsx");
    expect(src).toContain("duration: Number.POSITIVE_INFINITY");
    expect(src).toContain("toast.dismiss(alertId(p.appointmentId))");
    expect(src).toContain('"patient.arrived", "appointment.statusChanged", "queue.updated"');
  });

  it("the reception page no longer shows its own four-second toast", () => {
    const src = read("src/app/[locale]/crm/reception/_hooks/use-reception-live.ts");
    expect(src).not.toContain("toast(");
    expect(src).not.toContain('t("live.patientArrived")');
  });
});

describe("G3-01 review: a check-in counts only on the visit's own clinic day", () => {
  // Tapped 01.10 at 09:10 Tashkent; reception moved the visit to 08.10 14:00.
  const OLD_TAP = "2026-10-01T04:10:00.000Z";
  const MOVED_TO = "2026-10-08T09:00:00.000Z";

  it("a tap on the visit's day counts, one from another day does not", () => {
    expect(checkedInOnVisitDay({ arrivedAt: CHECKED_IN, date: VISIT })).toBe(true);
    expect(checkedInOnVisitDay({ arrivedAt: OLD_TAP, date: MOVED_TO })).toBe(false);
    expect(checkedInOnVisitDay({ arrivedAt: null, date: VISIT })).toBe(false);
    expect(checkedInOnVisitDay({ arrivedAt: "garbage", date: VISIT })).toBe(false);
  });

  it("the day is the clinic's, not UTC's", () => {
    // 23:55 Tashkent on 30.09 (18:55Z) is not the day of a 00:30 visit on
    // 01.10 (19:30Z the evening before in UTC).
    expect(
      checkedInOnVisitDay({
        arrivedAt: "2026-09-30T18:55:00.000Z",
        date: "2026-09-30T19:30:00.000Z",
      }),
    ).toBe(false);
    // 00:10 and 14:00 Tashkent on 01.10 are one clinic day, two UTC dates.
    expect(
      checkedInOnVisitDay({
        arrivedAt: "2026-09-30T19:10:00.000Z",
        date: "2026-10-01T09:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("the moved visit shows no badge and does not await the desk", () => {
    const row = { arrivedAt: OLD_TAP, date: MOVED_TO, status: "BOOKED", queueStatus: "BOOKED" };
    expect(awaitsDeskCheckIn(row)).toBe(false);
    expect(renderToStaticMarkup(React.createElement(SelfCheckInBadge, { row }))).toBe("");
  });

  it("a staff move to another clinic day drops the stamp; within the day it stays", () => {
    expect(checkInResetOnMove(new Date(VISIT), new Date(MOVED_TO))).toEqual({ arrivedAt: null });
    expect(
      checkInResetOnMove(new Date(VISIT), new Date("2026-10-01T11:30:00.000Z")),
    ).toEqual({});
    // 23:30 → 00:30 Tashkent crosses the clinic's midnight (19:00Z).
    expect(
      checkInResetOnMove(
        new Date("2026-10-01T18:30:00.000Z"),
        new Date("2026-10-01T19:30:00.000Z"),
      ),
    ).toEqual({ arrivedAt: null });
  });
});

describe("G3-01 review: reception's task goes with the visit", () => {
  type ActionRow = {
    id: string;
    type: string;
    severity: string;
    status: string;
    outcome: string | null;
    dedupeKey: string;
    payload: { type: string; appointmentId: string };
  };
  type Visit = { id: string; status: string; date: Date; arrivedAt: Date | null };

  function task(appointmentId: string): ActionRow {
    return {
      id: `task_${appointmentId}`,
      type: "SELF_CHECK_IN_UNHANDLED",
      severity: "high",
      status: "OPEN",
      outcome: null,
      dedupeKey: `SELF_CHECK_IN_UNHANDLED:appointmentId=${appointmentId}`,
      payload: { type: "SELF_CHECK_IN_UNHANDLED", appointmentId },
    };
  }

  function store(actions: ActionRow[], visits: Visit[]) {
    const audits: Array<{ meta: Record<string, unknown> }> = [];
    const prisma = {
      action: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              type?: { in: string[] };
              dedupeKey?: { in: string[] };
              status: { in: string[] };
            };
          }) =>
            actions.filter(
              (a) =>
                (!where.type || where.type.in.includes(a.type)) &&
                (!where.dedupeKey || where.dedupeKey.in.includes(a.dedupeKey)) &&
                where.status.in.includes(a.status),
            ),
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: { in: string[] }; status: { in: string[] } };
            data: Partial<ActionRow>;
          }) => {
            let count = 0;
            for (const a of actions) {
              if (where.id.in.includes(a.id) && where.status.in.includes(a.status)) {
                Object.assign(a, data);
                count += 1;
              }
            }
            return { count };
          },
        ),
      },
      appointment: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          visits.filter((v) => where.id.in.includes(v.id)),
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: { meta: Record<string, unknown> } }) => {
          audits.push(data);
          return {};
        }),
      },
    };
    const statusOf = (id: string) => actions.find((a) => a.id === id)!.status;
    return { prisma: prisma as never, audits, statusOf };
  }

  const at = (iso: string) => new Date(iso);

  it("the engine pass closes it once the visit moved on or off the check-in's day", async () => {
    const s = store(
      [task("ap_arrived"), task("ap_moved"), task("ap_in_hall")],
      [
        // «Пришёл» pressed after all.
        { id: "ap_arrived", status: "WAITING", date: at(VISIT), arrivedAt: at(CHECKED_IN) },
        // Reception moved it to 08.10, which dropped the stamp.
        { id: "ap_moved", status: "BOOKED", date: at("2026-10-08T09:00:00.000Z"), arrivedAt: null },
        // Still undecided: the task stays.
        { id: "ap_in_hall", status: "CONFIRMED", date: at(VISIT), arrivedAt: at(CHECKED_IN) },
      ],
    );

    expect(await retireMootRiskActions(s.prisma, "c1")).toBe(2);
    expect(s.statusOf("task_ap_arrived")).toBe("EXPIRED");
    expect(s.statusOf("task_ap_moved")).toBe("EXPIRED");
    expect(s.statusOf("task_ap_in_hall")).toBe("OPEN");
    expect(s.audits.map((a) => a.meta.reason).sort()).toEqual([
      "check_in_cleared",
      "visit_waiting",
    ]);
  });

  it("a person's «Не пришёл» closes it at once", async () => {
    const s = store([task("ap1")], []);
    expect(await retireVisitRiskActions(s.prisma, "c1", "ap1", "NO_SHOW")).toBe(1);
    expect(s.statusOf("task_ap1")).toBe("EXPIRED");
  });

  it("a visit still a booking keeps it on the single-visit path", async () => {
    const s = store([task("ap1")], []);
    expect(await retireVisitRiskActions(s.prisma, "c1", "ap1", "CONFIRMED")).toBe(0);
    expect(s.statusOf("task_ap1")).toBe("OPEN");
  });
});
