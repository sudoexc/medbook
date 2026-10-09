/**
 * Audit PT-13: the tiles above the patients list are counted on the server
 * over the whole base.
 *
 * They used to be counted from the rows the infinite list had loaded (50 per
 * page) and divided by the server total: «Активные: 12 (1,5%)» became 35
 * after a scroll, and «Средний чек» was the average lifetime value of the
 * loaded rows.
 *
 * Acceptance: the numbers do not depend on the list (they come from their
 * own endpoint), match a count over the clinic's base, and «Средний чек» is
 * the average paid amount per visit, or «нет данных» while payments are
 * not recorded in the CRM.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadPatientCounts, newThisWeekFrom } from "@/server/patient/list-tiles";

type Where = Record<string, unknown>;

type P = { clinicId: string; deletedAt: Date | null; createdAt: Date; segment: string };

function matches(p: P, where: Where): boolean {
  if (where.clinicId !== undefined && p.clinicId !== where.clinicId) return false;
  if ("deletedAt" in where && where.deletedAt === null && p.deletedAt !== null) return false;
  const created = where.createdAt as { gte: Date } | undefined;
  if (created && !(p.createdAt >= created.gte)) return false;
  const seg = where.segment as { in: string[] } | undefined;
  if (seg && !seg.in.includes(p.segment)) return false;
  return true;
}

function fakeDb(patients: P[]) {
  return {
    patient: {
      count: vi.fn(async ({ where }: { where: Where }) =>
        patients.filter((p) => matches(p, where)).length,
      ),
      groupBy: vi.fn(async ({ where }: { where: Where }) => {
        const counts = new Map<string, number>();
        for (const p of patients.filter((x) => matches(x, where))) {
          counts.set(p.segment, (counts.get(p.segment) ?? 0) + 1);
        }
        return [...counts].map(([segment, n]) => ({ segment, _count: { _all: n } }));
      }),
    },
  };
}

// Wednesday 30.09.2026 11:00 Tashkent.
const NOW = new Date("2026-09-30T06:00:00.000Z");
const DAY = 86_400_000;

describe("loadPatientCounts", () => {
  it("the week starts at the Tashkent midnight 7 days back", () => {
    // 23.09 00:00 Tashkent = 22.09 19:00Z.
    expect(newThisWeekFrom(NOW).toISOString()).toBe("2026-09-22T19:00:00.000Z");
  });

  it("counts the whole clinic, live patients only, segments from the column", async () => {
    const base = { clinicId: "c1", deletedAt: null };
    const patients: P[] = [
      ...Array.from({ length: 120 }, () => ({
        ...base,
        createdAt: new Date(NOW.getTime() - 200 * DAY),
        segment: "ACTIVE",
      })),
      ...Array.from({ length: 30 }, () => ({
        ...base,
        createdAt: new Date(NOW.getTime() - 200 * DAY),
        segment: "DORMANT",
      })),
      ...Array.from({ length: 5 }, () => ({
        ...base,
        createdAt: new Date(NOW.getTime() - 2 * DAY),
        segment: "NEW",
      })),
      // Deleted and another clinic's: never counted.
      { clinicId: "c1", deletedAt: new Date(), createdAt: NOW, segment: "ACTIVE" },
      { clinicId: "c2", deletedAt: null, createdAt: NOW, segment: "ACTIVE" },
    ];
    const out = await loadPatientCounts(fakeDb(patients) as never, {
      clinicId: "c1",
      now: NOW,
    });
    expect(out).toEqual({ total: 155, newThisWeek: 5, active: 120, dormant: 30 });
  });
});

// ----- the endpoint ------------------------------------------------------------

const h = vi.hoisted(() => ({
  role: "ADMIN" as string,
  tracked: null as Date | null,
  journeyAvg: 180_000_00 as number | null,
  journey: vi.fn(),
}));

function mountRoute() {
  vi.resetModules();
  vi.doMock("@/lib/auth", () => ({
    auth: vi.fn(async () => ({
      user: { id: "u1", role: h.role, clinicId: "c1", email: "x@example.test" },
    })),
  }));
  vi.doMock("@/lib/pin", () => ({ hasValidPin: () => false }));
  vi.doMock("@/lib/tenant-context", () => ({
    runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
    getTenant: () => ({ kind: "TENANT" as const, clinicId: "c1", userId: "u1", role: h.role }),
  }));
  vi.doMock("@/server/platform/branch-cookie", () => ({
    readActiveBranchFromCookieHeader: () => null,
  }));
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      ...fakeDb([
        { clinicId: "c1", deletedAt: null, createdAt: NOW, segment: "ACTIVE" },
      ]),
      doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
    },
  }));
  vi.doMock("@/server/patient/finance", () => ({
    paymentsRecordedSince: vi.fn(async () => h.tracked),
  }));
  vi.doMock("@/server/analytics/patient-journey", () => ({
    loadPatientJourney: h.journey.mockImplementation(async () => ({
      avgCheck: h.journeyAvg,
    })),
  }));
}

async function get() {
  const { GET } = await import("@/app/api/crm/patients/tiles/route");
  const res = await GET(new Request("https://x/api/crm/patients/tiles"));
  return (await res.json()) as {
    total: number;
    avgCheck: { visible: boolean; paymentsTracked: boolean; value: number | null };
  };
}

describe("GET /api/crm/patients/tiles", () => {
  beforeEach(() => {
    h.role = "ADMIN";
    h.tracked = null;
    h.journeyAvg = 180_000_00;
    h.journey.mockReset();
    mountRoute();
  });

  it("payments not recorded in the CRM: no average check, said so", async () => {
    const body = await get();
    expect(body.total).toBe(1);
    expect(body.avgCheck).toEqual({ visible: true, paymentsTracked: false, value: null });
    expect(h.journey).not.toHaveBeenCalled();
  });

  it("payments recorded: the analytics average paid amount per visit", async () => {
    h.tracked = new Date("2026-09-01T00:00:00.000Z");
    const body = await get();
    expect(body.avgCheck).toEqual({
      visible: true,
      paymentsTracked: true,
      value: 180_000_00,
    });
    expect(h.journey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doctorId: null, paymentsTracked: true }),
    );
  });

  it("a doctor gets his own visits' figure", async () => {
    h.role = "DOCTOR";
    h.tracked = new Date("2026-09-01T00:00:00.000Z");
    mountRoute();
    await get();
    expect(h.journey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doctorId: "doc_1" }),
    );
  });

  it("the owner inside a clinic gets the clinic's figure, as its admin does (owner request 09.10.2026)", async () => {
    h.role = "SUPER_ADMIN";
    h.tracked = new Date("2026-09-01T00:00:00.000Z");
    mountRoute();
    const body = await get();
    expect(body.avgCheck).toEqual({ visible: true, paymentsTracked: true, value: 180_000_00 });
    expect(h.journey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doctorId: null }),
    );
  });

  it("reception does not get clinic money", async () => {
    h.role = "RECEPTIONIST";
    h.tracked = new Date("2026-09-01T00:00:00.000Z");
    mountRoute();
    const body = await get();
    expect(body.avgCheck.visible).toBe(false);
    expect(body.avgCheck.value).toBeNull();
  });
});

describe("the tiles no longer read the loaded rows", () => {
  it("PatientsTiles takes no rows and loads its own numbers", () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../src/app/[locale]/crm/patients/_components/patients-tiles.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("usePatientsTiles()");
    expect(src).not.toMatch(/rows\s*:\s*PatientRow\[\]/);
    expect(src).not.toMatch(/ltvSum|ltvCount/);
    const page = readFileSync(
      path.resolve(
        __dirname,
        "../../src/app/[locale]/crm/patients/_components/patients-page-client.tsx",
      ),
      "utf8",
    );
    expect(page).toMatch(/<PatientsTiles activeKey="all" \/>/);
  });
});
