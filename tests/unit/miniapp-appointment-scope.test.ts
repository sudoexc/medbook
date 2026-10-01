/**
 * Audit MA-20: today's visit and the live queue vanished from the Mini App.
 *
 * «Предстоящие» was `date >= now`. A live-queue visit is created with
 * `date = now`, so it was «past» a second after the ticket was printed and
 * the home screen never showed the queue position; a booking for 10:00 left
 * the home screen at 10:00, taking «Я на месте» from a patient five minutes
 * late. A visit now stays upcoming until it finishes, for the whole clinic
 * day, and «Прошедшие» is exactly the rest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isMiniAppUpcoming,
  miniAppAppointmentScopeWhere,
} from "@/server/miniapp/appointment-scope";

type Row = { status: string; date: Date; endDate: Date };

/** Evaluates the subset of a Prisma where the scope builder emits. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const value = row[key as keyof Row];
    const c = cond as Record<string, unknown>;
    if ("in" in c && !(c.in as unknown[]).includes(value)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).includes(value)) return false;
    if ("gte" in c && !((value as Date).getTime() >= (c.gte as Date).getTime())) return false;
    if ("lt" in c && !((value as Date).getTime() < (c.lt as Date).getTime())) return false;
  }
  return true;
}

// 15:00 in Tashkent on 1 October.
const now = new Date("2026-10-01T10:00:00.000Z");
const min = 60_000;

function row(status: string, startIso: string, durationMin = 30): Row {
  const date = new Date(startIso);
  return { status, date, endDate: new Date(date.getTime() + durationMin * min) };
}

function scopeOf(r: Row): "upcoming" | "past" {
  const up = matches(r, miniAppAppointmentScopeWhere("upcoming", now) as Record<string, unknown>);
  const past = matches(r, miniAppAppointmentScopeWhere("past", now) as Record<string, unknown>);
  // Every visit is in exactly one tab.
  expect(up, `${r.status} ${r.date.toISOString()}`).not.toBe(past);
  expect(isMiniAppUpcoming(r, now)).toBe(up);
  return up ? "upcoming" : "past";
}

describe("miniAppAppointmentScopeWhere", () => {
  it("files a live-queue visit created a moment ago as upcoming", () => {
    const walkIn = { status: "WAITING", date: new Date(now.getTime() - 1000), endDate: new Date(now.getTime() + 19 * min) };
    expect(scopeOf(walkIn)).toBe("upcoming");
    expect(scopeOf({ ...walkIn, status: "IN_PROGRESS" })).toBe("upcoming");
  });

  it("keeps a late booking from this morning upcoming for the rest of the day", () => {
    // 10:00 Tashkent, 30 minutes, nobody marked it yet.
    expect(scopeOf(row("BOOKED", "2026-10-01T05:00:00.000Z"))).toBe("upcoming");
    expect(scopeOf(row("CONFIRMED", "2026-10-01T05:00:00.000Z"))).toBe("upcoming");
  });

  it("files finished visits as past, even today's", () => {
    for (const s of ["COMPLETED", "CANCELLED", "NO_SHOW"]) {
      expect(scopeOf(row(s, "2026-10-01T05:00:00.000Z"))).toBe("past");
      expect(scopeOf(row(s, "2026-10-03T05:00:00.000Z"))).toBe("past");
    }
  });

  it("files a WAITING row left over from yesterday as history, not a live queue", () => {
    expect(scopeOf(row("WAITING", "2026-09-30T06:00:00.000Z"))).toBe("past");
  });

  it("uses the clinic day: 00:10 Tashkent today is today, 23:50 yesterday is not", () => {
    // 00:10 on 1 Oct Tashkent = 19:10Z on 30 Sep.
    expect(scopeOf(row("BOOKED", "2026-09-30T19:10:00.000Z"))).toBe("upcoming");
    // 23:30 on 30 Sep Tashkent, ended at 00:00.
    expect(scopeOf(row("BOOKED", "2026-09-30T18:30:00.000Z"))).toBe("past");
  });

  it("keeps future visits upcoming", () => {
    expect(scopeOf(row("BOOKED", "2026-10-02T04:00:00.000Z"))).toBe("upcoming");
  });
});

// --- the route ---------------------------------------------------------------

const state = vi.hoisted(() => ({ where: [] as Array<Record<string, unknown>> }));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p1",
    patient: { id: "p1", fullName: "Dilnoza", preferredLang: "RU" },
  };
  const wrap =
    (_opts: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({ request, body: undefined, ctx });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        state.where.push(args.where);
        return [];
      }),
    },
  },
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/miniapp/idempotency", () => ({ withIdempotency: vi.fn() }));
vi.mock("@/server/observability/metrics", () => ({ getMetrics: vi.fn() }));
vi.mock("@/server/appointments/book", () => ({ bookAppointment: vi.fn() }));

import { GET } from "@/app/api/miniapp/appointments/route";

beforeEach(() => {
  state.where.length = 0;
});

describe("GET /api/miniapp/appointments", () => {
  it("scopes both tabs by the shared rule, inside the patient's own rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await GET(new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax"));
      await GET(new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax&scope=past"));
    } finally {
      vi.useRealTimers();
    }
    expect(state.where[0]).toEqual({
      clinicId: "c1",
      patientId: "p1",
      ...miniAppAppointmentScopeWhere("upcoming", now),
    });
    expect(state.where[1]).toEqual({
      clinicId: "c1",
      patientId: "p1",
      ...miniAppAppointmentScopeWhere("past", now),
    });
  });
});
