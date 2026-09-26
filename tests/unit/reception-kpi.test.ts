/**
 * Audit UX-02: the reception KPI strip told the desk the wrong story.
 *
 *   - «В очереди сейчас» added BOOKED and CONFIRMED to WAITING: at 9:00 it
 *     read 42 people in a hall of 3.
 *   - «Прибыли сегодня» showed the COMPLETED count: 10 patients in the
 *     building read as 0 until the first visit closed.
 *   - Revenue rendered MoneyText («1 500 000 сум») plus a unit «сум», and
 *     linked a receptionist to the ADMIN-only financial page, a 404.
 *   - The sidebar load left CONFIRMED out, so a patient pressing
 *     «Подтверждаю» in Telegram made the load DROP.
 *
 * Acceptance: 3 waiting + 20 future bookings show 3; arrivals count every
 * checked-in patient; the revenue line names the currency once and is shown
 * only to roles that can open the financial page; confirming a booking does
 * not lower the load.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  appts: [] as Array<{ status: string; durationMin: number }>,
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
// Render the target number itself: the real CountUp starts at 0 until an
// effect animates it, which never runs in a static render.
vi.mock("@/components/atoms/count-up", () => ({
  CountUp: ({ to }: { to: number }) => String(to),
  useCountUp: (n: number) => n,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    scroll?: boolean;
  }) => React.createElement("a", { href, ...rest }, children),
}));

// The shell-summary route suite.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u1",
    role: "RECEPTIONIST" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      count: vi.fn(async () => h.appts.length),
      aggregate: vi.fn(
        async ({ where }: { where: { status: { in: string[] } } }) => ({
          _sum: {
            durationMin: h.appts
              .filter((a) => where.status.in.includes(a.status))
              .reduce((n, a) => n + a.durationMin, 0),
          },
        }),
      ),
    },
    doctorSchedule: {
      // One doctor, 09:00–17:00: 480 available minutes.
      findMany: vi.fn(async () => [{ startTime: "09:00", endTime: "17:00" }]),
    },
    call: { count: vi.fn(async () => 0) },
    conversation: { count: vi.fn(async () => 0) },
    notificationSend: { count: vi.fn(async () => 0) },
    lead: { count: vi.fn(async () => 0) },
  },
}));

import {
  canSeeClinicRevenue,
  receptionQueueKpis,
} from "@/lib/reception-kpi";
import { KpiStrip } from "@/app/[locale]/crm/reception/_components/kpi-strip";
import { computeUpcomingReminders } from "@/app/[locale]/crm/reception/_hooks/use-reception-live";
import type { DashboardResponse } from "@/app/[locale]/crm/reception/_hooks/use-reception-live";
import type { AppointmentRow } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-list";
import {
  CrmRoleProvider,
  type Role,
} from "@/app/[locale]/crm/patients/[id]/_hooks/use-current-role";

beforeEach(() => {
  h.appts = [];
});

const buckets = [
  { status: "WAITING", count: 3 },
  { status: "BOOKED", count: 8 },
  { status: "CONFIRMED", count: 12 },
  { status: "SKIPPED", count: 1 },
  { status: "IN_PROGRESS", count: 2 },
  { status: "COMPLETED", count: 5 },
  { status: "NO_SHOW", count: 1 },
  { status: "CANCELLED", count: 2 },
] as DashboardResponse["queue"];

describe("UX-02: the queue counters", () => {
  it("«В очереди сейчас» is only who is waiting: 3, not 3 + 20 bookings", () => {
    expect(receptionQueueKpis(buckets).waitingNow).toBe(3);
  });

  it("«Прибыли» counts every checked-in patient, not only the completed", () => {
    // WAITING 3 + SKIPPED 1 + IN_PROGRESS 2 + COMPLETED 5.
    expect(receptionQueueKpis(buckets).arrived).toBe(11);
    // Ten people in the building before any visit closes: ten, not zero.
    expect(
      receptionQueueKpis([
        { status: "WAITING", count: 8 },
        { status: "IN_PROGRESS", count: 2 },
      ]).arrived,
    ).toBe(10);
  });

  it("no data yet reads zero everywhere", () => {
    expect(receptionQueueKpis(undefined)).toEqual({
      waitingNow: 0,
      arrived: 0,
      inProgress: 0,
      completed: 0,
      noShow: 0,
    });
  });

  it("revenue is for the roles the financial page admits", () => {
    expect(canSeeClinicRevenue("ADMIN")).toBe(true);
    expect(canSeeClinicRevenue("SUPER_ADMIN")).toBe(true);
    for (const role of ["RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"]) {
      expect(canSeeClinicRevenue(role)).toBe(false);
    }
  });
});

describe("UX-02: the strip as rendered", () => {
  const dashboard = {
    today: {
      booked: 8,
      inProgress: 2,
      completed: 5,
      cancelled: 2,
      revenue: 150_000_000, // 1 500 000 сум, in tiyin
    },
    queue: buckets,
  } as unknown as DashboardResponse;

  function strip(role: Role): string {
    return renderToStaticMarkup(
      React.createElement(CrmRoleProvider, {
        role,
        children: React.createElement(KpiStrip, {
          dashboard,
          todayRows: new Array(34).fill({}) as AppointmentRow[],
          totalDoctors: 2,
        }),
      }),
    );
  }

  /** The text of the tile whose label is `labelKey`, up to the next tile. */
  function tile(html: string, labelKey: string): string {
    const at = html.indexOf(`reception.kpi.${labelKey}<`);
    expect(at).toBeGreaterThan(-1);
    const next = html.indexOf("<a ", at);
    return html.slice(at, next === -1 ? undefined : next);
  }

  it("shows 3 waiting and 11 arrived", () => {
    const html = strip("RECEPTIONIST");
    expect(tile(html, "waiting")).toContain(">3<");
    expect(tile(html, "checkedIn")).toContain(">11<");
  });

  it("a receptionist gets no revenue tile and no link to the admin-only page", () => {
    const html = strip("RECEPTIONIST");
    expect(html).not.toContain("reception.kpi.revenue");
    expect(html).not.toContain("/crm/analytics/financial");
  });

  it("an admin's revenue line names the currency once", () => {
    const html = strip("ADMIN");
    const revenue = tile(html, "revenue");
    expect(revenue).toMatch(/1\s500\s000\sсум/);
    expect(revenue.match(/сум/g)).toHaveLength(1);
    expect(html).toContain('href="/crm/analytics/financial"');
  });
});

describe("UX-02: the sidebar load counts confirmed bookings", () => {
  async function loadPercent(): Promise<number> {
    vi.resetModules();
    const { GET } = await import("@/app/api/crm/shell-summary/route");
    const res = await GET(new Request("https://x/api/crm/shell-summary"));
    const body = (await res.json()) as { today: { loadPercent: number } };
    return body.today.loadPercent;
  }

  it("a patient confirming in Telegram does not lower the load", async () => {
    h.appts = [
      { status: "BOOKED", durationMin: 60 },
      { status: "BOOKED", durationMin: 60 },
      { status: "WAITING", durationMin: 60 },
      { status: "COMPLETED", durationMin: 60 },
    ];
    const before = await loadPercent();
    expect(before).toBe(50); // 240 of 480 minutes

    h.appts[0].status = "CONFIRMED";
    expect(await loadPercent()).toBe(before);
  });

  it("cancelled and no-show visits still free the chair", async () => {
    h.appts = [
      { status: "CONFIRMED", durationMin: 120 },
      { status: "CANCELLED", durationMin: 120 },
      { status: "NO_SHOW", durationMin: 120 },
    ];
    expect(await loadPercent()).toBe(25);
  });
});

describe("UX-02: «Срочные оповещения» include confirmed bookings", () => {
  it("a phone booking (created CONFIRMED) 30 minutes out is listed", () => {
    const now = new Date("2026-09-26T05:00:00.000Z");
    const row = (id: string, status: string) =>
      ({
        id,
        status,
        date: new Date(now.getTime() + 30 * 60_000).toISOString(),
      }) as unknown as AppointmentRow;
    const out = computeUpcomingReminders(
      [row("c", "CONFIRMED"), row("b", "BOOKED"), row("x", "CANCELLED")],
      now,
    ) as Array<{ appointment: Row }>;
    expect(out.map((r) => r.appointment.id).sort()).toEqual(["b", "c"]);
  });
});
