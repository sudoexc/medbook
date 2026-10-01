/**
 * Audit AN-22 — CONFIRMED counts wherever bookings are counted.
 *
 * Phone bookings are created CONFIRMED and a patient's «Подтверждаю» moves a
 * booking there, so on this clinic CONFIRMED is the normal state of a visit
 * ahead. It was missing from the revenue forecast, the empty-slot snapshot
 * (a confirmed hour was priced as a loss), the reactivation filter (a patient
 * with a confirmed visit got «мы скучаем»), and the report builder's status
 * filter (zod refused it). The sidebar load also measured against schedules
 * that had ended and doctors on leave.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  appointmentWheres: [] as Array<Record<string, unknown>>,
  schedules: [] as Array<Record<string, unknown>>,
  timeOffs: [] as Array<Record<string, unknown>>,
  bookedMinutes: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
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
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        h.appointmentWheres.push(args.where);
        return [];
      }),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { durationMin: h.bookedMinutes } })),
    },
    service: { findMany: vi.fn(async () => []) },
    // The forecast reads the empty-slot snapshots too (audit AN-21).
    emptySlotSnapshot: { findMany: vi.fn(async () => []) },
    doctorSchedule: { findMany: vi.fn(async () => h.schedules) },
    doctorTimeOff: { findMany: vi.fn(async () => h.timeOffs) },
    call: { count: vi.fn(async () => 0) },
    conversation: { count: vi.fn(async () => 0) },
    notificationSend: { count: vi.fn(async () => 0) },
    lead: { count: vi.fn(async () => 0) },
  },
}));

beforeEach(() => {
  h.appointmentWheres = [];
  h.schedules = [];
  h.timeOffs = [];
  h.bookedMinutes = 0;
});

describe("CONFIRMED is a booking", () => {
  it("the revenue forecast counts confirmed visits in its pipeline", async () => {
    const { loadForecast } = await import("@/server/revenue/forecast-data");
    await loadForecast("c1", new Date("2026-09-30T06:00:00Z"));
    const pipeline = h.appointmentWheres[0]!.status as { in: string[] };
    expect(pipeline.in).toEqual(
      expect.arrayContaining(["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS"]),
    );
  });

  it("a confirmed hour is not an empty slot", async () => {
    const { SLOT_OCCUPYING_STATUSES } = await import("@/server/revenue/empty-slot");
    expect(SLOT_OCCUPYING_STATUSES).toContain("CONFIRMED");
    expect(SLOT_OCCUPYING_STATUSES).not.toContain("CANCELLED");
  });

  it("a patient with a confirmed visit ahead is not reactivated", async () => {
    const { findReactivationCandidates } = await import("@/server/revenue/reactivation");
    const now = new Date("2026-09-30T06:00:00Z");
    const lastVisitAt = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
    const futureWheres: Array<Record<string, unknown>> = [];
    const prisma = {
      patient: {
        findMany: async () => [
          {
            id: "p1",
            lastVisitAt,
            reactivationSentAt: [],
            dormantSince: null,
            marketingOptOut: false,
            deletedAt: null,
          },
        ],
      },
      appointment: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          futureWheres.push(where);
          const statuses = (where.status as { in: string[] }).in;
          return statuses.includes("CONFIRMED") ? [{ patientId: "p1" }] : [];
        },
      },
    } as never;
    const out = await findReactivationCandidates(prisma, "c1", now);
    expect(futureWheres).toHaveLength(1);
    expect(out).toEqual([]);
  });

  it("the report builder accepts «Подтверждена» as a status filter", async () => {
    const { parseReportConfig, APPOINTMENT_STATUS_VALUES } = await import(
      "@/server/analytics/report-config"
    );
    expect(APPOINTMENT_STATUS_VALUES).toContain("CONFIRMED");
    const cfg = parseReportConfig({
      version: 1,
      dimensions: ["doctor"],
      measures: ["count_visits"],
      filters: { status: ["CONFIRMED"] },
    });
    expect(cfg.filters.status).toEqual(["CONFIRMED"]);
  });
});

describe("sidebar load", () => {
  async function loadPercent(): Promise<number> {
    vi.resetModules();
    const { GET } = await import("@/app/api/crm/shell-summary/route");
    const res = await (GET as (r: Request) => Promise<Response>)(
      new Request("https://x/api/crm/shell-summary"),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { today: { loadPercent: number } }).today.loadPercent;
  }

  function scheduleToday(over: Record<string, unknown> = {}) {
    // Every weekday, 09:00 to 13:00: 240 minutes a day.
    return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      doctorId: "d1",
      weekday,
      startTime: "09:00",
      endTime: "13:00",
      validFrom: null,
      validTo: null,
      ...over,
    }));
  }

  it("counts confirmed minutes against the working minutes", async () => {
    h.schedules = scheduleToday();
    h.bookedMinutes = 120;
    expect(await loadPercent()).toBe(50);
  });

  it("a schedule that has ended gives no minutes to fill", async () => {
    h.schedules = scheduleToday({ validTo: new Date("2020-01-01T00:00:00Z") });
    h.bookedMinutes = 120;
    expect(await loadPercent()).toBe(0);
  });

  it("time off is taken out of the working minutes", async () => {
    h.schedules = [
      ...scheduleToday(),
      ...scheduleToday({ doctorId: "d2" }),
    ];
    // d2 is away all week: only d1's 240 minutes are there to fill.
    h.timeOffs = [
      {
        doctorId: "d2",
        startAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ];
    h.bookedMinutes = 120;
    expect(await loadPercent()).toBe(50);
  });
});
