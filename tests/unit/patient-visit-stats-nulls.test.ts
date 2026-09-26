/**
 * Audit PT-06: «Последний визит» froze on an old date.
 *
 * `refreshPatientVisitStats` took the first row of
 * `ORDER BY completedAt DESC, date DESC`. Postgres sorts NULLs FIRST in a
 * descending order, so one legacy COMPLETED row without `completedAt` won
 * over every real visit, and lastVisitAt stayed on its March slot: the card
 * showed «Последний визит: 12.03» and the dormant detector queued a
 * reactivation for a patient seen yesterday.
 *
 * The prisma mock below orders like Postgres does (NULLs first on DESC), so
 * the old query shape fails this suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Appt = {
  patientId: string;
  status: string;
  completedAt: Date | null;
  date: Date;
};

const state = {
  appts: [] as Appt[],
  patientWrites: [] as Array<Record<string, unknown>>,
};

type Where = {
  patientId?: string;
  status?: string;
  completedAt?: null | { not: null };
};

function matches(a: Appt, where: Where): boolean {
  if (where.patientId !== undefined && a.patientId !== where.patientId) return false;
  if (where.status !== undefined && a.status !== where.status) return false;
  if (where.completedAt === null && a.completedAt !== null) return false;
  if (
    where.completedAt !== undefined &&
    where.completedAt !== null &&
    a.completedAt === null
  ) {
    return false;
  }
  return true;
}

type Order = Record<string, "asc" | "desc">;

/** Postgres semantics: NULLS LAST on ASC, NULLS FIRST on DESC. */
function pgCompare(a: Appt, b: Appt, orders: Order[]): number {
  for (const o of orders) {
    const [field, dir] = Object.entries(o)[0] as [keyof Appt, "asc" | "desc"];
    const av = a[field] as Date | null;
    const bv = b[field] as Date | null;
    if (av === null && bv === null) continue;
    if (av === null) return dir === "desc" ? -1 : 1;
    if (bv === null) return dir === "desc" ? 1 : -1;
    const d = av.getTime() - bv.getTime();
    if (d !== 0) return dir === "desc" ? -d : d;
  }
  return 0;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      count: vi.fn(
        async ({ where }: { where: Where }) =>
          state.appts.filter((a) => matches(a, where)).length,
      ),
      findFirst: vi.fn(
        async ({ where, orderBy }: { where: Where; orderBy: Order | Order[] }) => {
          const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
          const rows = state.appts
            .filter((a) => matches(a, where))
            .sort((a, b) => pgCompare(a, b, orders));
          return rows[0] ?? null;
        },
      ),
    },
    patient: {
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.patientWrites.push(data);
        return { count: 1 };
      }),
    },
  },
}));

import {
  latestVisitAt,
  refreshPatientVisitStats,
} from "@/server/patient/last-contacted";

beforeEach(() => {
  state.appts = [];
  state.patientWrites = [];
});

describe("PT-06: lastVisitAt = MAX(COALESCE(completedAt, date))", () => {
  it("a legacy row without completedAt no longer beats a fresh visit", async () => {
    state.appts = [
      // March, closed before `completedAt` was populated.
      {
        patientId: "p1",
        status: "COMPLETED",
        completedAt: null,
        date: new Date("2026-03-12T05:00:00.000Z"),
      },
      // Yesterday, closed from the queue board.
      {
        patientId: "p1",
        status: "COMPLETED",
        completedAt: new Date("2026-09-25T06:40:00.000Z"),
        date: new Date("2026-09-25T06:00:00.000Z"),
      },
    ];

    await refreshPatientVisitStats("p1");

    expect(state.patientWrites).toEqual([
      {
        visitsCount: 2,
        lastVisitAt: new Date("2026-09-25T06:40:00.000Z"),
      },
    ]);
  });

  it("a legacy slot newer than every stamped completion still counts", async () => {
    state.appts = [
      {
        patientId: "p1",
        status: "COMPLETED",
        completedAt: new Date("2026-05-02T07:00:00.000Z"),
        date: new Date("2026-05-02T06:30:00.000Z"),
      },
      {
        patientId: "p1",
        status: "COMPLETED",
        completedAt: null,
        date: new Date("2026-06-10T05:00:00.000Z"),
      },
    ];

    await refreshPatientVisitStats("p1");

    expect(state.patientWrites[0]).toMatchObject({
      visitsCount: 2,
      lastVisitAt: new Date("2026-06-10T05:00:00.000Z"),
    });
  });

  it("uses when the visit ended, not a future booked slot seen early", async () => {
    state.appts = [
      {
        patientId: "p1",
        status: "COMPLETED",
        completedAt: new Date("2026-09-25T06:40:00.000Z"),
        date: new Date("2026-10-02T06:00:00.000Z"),
      },
    ];

    await refreshPatientVisitStats("p1");

    expect(state.patientWrites[0]).toMatchObject({
      lastVisitAt: new Date("2026-09-25T06:40:00.000Z"),
    });
  });

  it("ignores visits that are not COMPLETED and clears the date with none left", async () => {
    state.appts = [
      {
        patientId: "p1",
        status: "NO_SHOW",
        completedAt: null,
        date: new Date("2026-09-20T06:00:00.000Z"),
      },
    ];

    await refreshPatientVisitStats("p1");

    expect(state.patientWrites[0]).toEqual({ visitsCount: 0, lastVisitAt: null });
  });
});

describe("latestVisitAt", () => {
  const a = new Date("2026-09-01T00:00:00.000Z");
  const b = new Date("2026-09-02T00:00:00.000Z");

  it("takes the later of the two, whichever side it is on", () => {
    expect(latestVisitAt(a, b)).toBe(b);
    expect(latestVisitAt(b, a)).toBe(b);
  });

  it("falls back to whichever exists", () => {
    expect(latestVisitAt(null, a)).toBe(a);
    expect(latestVisitAt(a, null)).toBe(a);
    expect(latestVisitAt(null, null)).toBeNull();
  });
});
