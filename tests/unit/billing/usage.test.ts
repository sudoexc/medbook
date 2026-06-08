/**
 * Phase 19 Wave 1 — `getClinicUsage` happy-path coverage.
 *
 * Mocks `@/lib/prisma` + `@/lib/tenant-context` so the helper runs DB-less.
 * The interesting invariants:
 *
 *   - month-window math is half-open: last instant of the month belongs to
 *     the window, first instant of the next month does not.
 *   - the SYSTEM tenant context wraps every query (we don't assert directly,
 *     but the mock simply forwards without filtering, so any over-injection
 *     by the real extension would surface as a failing arg in tests later).
 *   - storage rounds bytes → MB.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

interface CapturedCall {
  where: Record<string, unknown>;
}

interface State {
  patientWhere: CapturedCall["where"] | null;
  appointmentWhere: CapturedCall["where"] | null;
  documentWhere: CapturedCall["where"] | null;
  patientCount: number;
  appointmentCount: number;
  storageSumBytes: number;
}

const state: State = {
  patientWhere: null,
  appointmentWhere: null,
  documentWhere: null,
  patientCount: 0,
  appointmentCount: 0,
  storageSumBytes: 0,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.patientWhere = where;
        return state.patientCount;
      }),
    },
    appointment: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.appointmentWhere = where;
        return state.appointmentCount;
      }),
    },
    document: {
      aggregate: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          state.documentWhere = where;
          return { _sum: { sizeBytes: state.storageSumBytes } };
        },
      ),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (
    _ctx: unknown,
    fn: () => Promise<unknown>,
  ): Promise<unknown> => fn(),
}));

import { getClinicUsage, monthWindow } from "@/server/billing/usage";

beforeEach(() => {
  state.patientWhere = null;
  state.appointmentWhere = null;
  state.documentWhere = null;
  state.patientCount = 0;
  state.appointmentCount = 0;
  state.storageSumBytes = 0;
});

describe("monthWindow", () => {
  it("returns first-of-month start and first-of-next-month end (UTC)", () => {
    const now = new Date("2026-05-07T13:42:11.123Z");
    const { start, end } = monthWindow(now);
    expect(start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("rolls year on December → January", () => {
    const now = new Date("2026-12-15T00:00:00.000Z");
    const { start, end } = monthWindow(now);
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("includes 23:59:59.999 of the last day, excludes first instant of next month", () => {
    const last = new Date("2026-05-31T23:59:59.999Z");
    const { start, end } = monthWindow(last);
    expect(last.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(last.getTime()).toBeLessThan(end.getTime());

    const nextFirst = new Date("2026-06-01T00:00:00.000Z");
    const window = monthWindow(last);
    expect(nextFirst.getTime()).toBeGreaterThanOrEqual(window.end.getTime());
  });
});

describe("getClinicUsage", () => {
  it("aggregates patient + appointment + storage", async () => {
    state.patientCount = 42;
    state.appointmentCount = 10;
    state.storageSumBytes = 3 * 1_048_576 + 524288; // 3.5 MB

    const now = new Date("2026-05-07T12:00:00.000Z");
    const snap = await getClinicUsage("clinic-1", now);

    expect(snap.patientCount).toBe(42);
    expect(snap.appointmentCountThisMonth).toBe(10);
    // 3.5 → rounds to 4
    expect(snap.storageMb).toBe(4);
    expect(snap.asOf).toBe(now);
  });

  it("scopes patient query by clinicId AND deletedAt:null", async () => {
    await getClinicUsage("clinic-x", new Date("2026-05-07T00:00:00Z"));
    expect(state.patientWhere).toEqual({
      clinicId: "clinic-x",
      deletedAt: null,
    });
  });

  it("scopes appointment query to the current month half-open window", async () => {
    await getClinicUsage("clinic-x", new Date("2026-05-15T00:00:00Z"));
    const where = state.appointmentWhere as {
      clinicId: string;
      createdAt: { gte: Date; lt: Date };
    };
    expect(where.clinicId).toBe("clinic-x");
    expect(where.createdAt.gte.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(where.createdAt.lt.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("storageMb rounds to nearest MB and returns 0 when no documents", async () => {
    state.storageSumBytes = 0;
    const snap = await getClinicUsage(
      "clinic-x",
      new Date("2026-05-15T00:00:00Z"),
    );
    expect(snap.storageMb).toBe(0);
  });

  it("storageMb handles BigInt-ish small values rounded down to 0", async () => {
    state.storageSumBytes = 100; // 100 bytes → ~0 MB
    const snap = await getClinicUsage(
      "clinic-x",
      new Date("2026-05-15T00:00:00Z"),
    );
    expect(snap.storageMb).toBe(0);
  });
});
