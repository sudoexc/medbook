/**
 * Audit AN-15: the «Путь пациента» strip invented its numbers.
 *
 * In the browser, completed visits fell back to `total × 0.62`, repeat
 * visits were completed × the share of multi-visit medical CASES, first
 * consultations were the remainder, and new patients were
 * `max(open cases ever, first consultations × 0.76)`: a week with five new
 * patients showed 38. Pinned here:
 *   - new patients = patients whose first COMPLETED visit (in scope) falls
 *     in the window; repeat visits = the rest of the window's completed
 *     visits; each is a count a query can reproduce;
 *   - the loader's queries are exactly those counts (COMPLETED, window,
 *     soft-deleted patients out, doctor scope, «before the window»);
 *   - the average check only counts paid visits, and says nothing while the
 *     clinic does not record payments in the CRM;
 *   - a DOCTOR login with no Doctor row gets an empty strip, not the clinic;
 *   - no 0.62 / 0.76 anywhere in the strip, the cases endpoint is gone.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_JOURNEY,
  computePatientJourney,
  loadPatientJourney,
  type JourneyDb,
} from "@/server/analytics/patient-journey";

const state = vi.hoisted(() => ({
  role: "ADMIN" as string,
  doctorRow: null as null | { id: string },
  trackedSince: null as Date | null,
  findManyArgs: [] as Array<Record<string, unknown>>,
  windowRows: [] as Array<{ patientId: string; payments: Array<{ amount: number }> }>,
  priorRows: [] as Array<{ patientId: string }>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: state.role, clinicId: "c1", email: "o@x.t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u1", role: state.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => state.doctorRow) },
    clinic: {
      findUnique: vi.fn(async () => ({ paymentsTrackedSince: state.trackedSince })),
    },
    appointment: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        state.findManyArgs.push(args);
        const where = args.where as { date: Record<string, unknown> };
        return "gte" in where.date ? state.windowRows : state.priorRows;
      }),
    },
  },
}));

beforeEach(() => {
  state.role = "ADMIN";
  state.doctorRow = null;
  state.trackedSince = null;
  state.findManyArgs = [];
  state.windowRows = [];
  state.priorRows = [];
});

const visit = (patientId: string, paidAmount = 0) => ({
  patientId,
  paidAmount,
  paid: paidAmount > 0,
});

describe("computePatientJourney: counts, not coefficients", () => {
  it("splits the window's visits into first and repeat by the patient's history", () => {
    const j = computePatientJourney({
      visits: [
        visit("p1"), // p1: first ever visit, then a follow-up in the window
        visit("p1"),
        visit("p2"), // p2 came before the window
        visit("p3"), // p3: first ever visit
      ],
      returningPatientIds: ["p2"],
      paymentsTracked: false,
    });
    expect(j).toMatchObject({
      visits: 4,
      patients: 3,
      newPatients: 2,
      repeatVisits: 2,
      repeatPct: 50,
    });
  });

  it("a week with five new patients says five, however many cases are open", () => {
    const returning = Array.from({ length: 30 }, (_, i) => `old${i}`);
    const j = computePatientJourney({
      visits: [
        ...["n1", "n2", "n3", "n4", "n5"].map((id) => visit(id)),
        ...returning.map((id) => visit(id)),
      ],
      returningPatientIds: returning,
      paymentsTracked: false,
    });
    expect(j.newPatients).toBe(5);
    expect(j.repeatVisits).toBe(30);
    expect(j.visits).toBe(35);
    expect(j.repeatPct).toBe(85.7);
  });

  it("is all zeros for an empty window, not a division by zero", () => {
    expect(
      computePatientJourney({ visits: [], returningPatientIds: [], paymentsTracked: true }),
    ).toEqual({ ...EMPTY_JOURNEY, paymentsTracked: true });
  });

  it("averages the check over paid visits only", () => {
    const j = computePatientJourney({
      visits: [visit("p1", 200_000_00), visit("p2", 300_000_00), visit("p3")],
      returningPatientIds: [],
      paymentsTracked: true,
    });
    expect(j.paidVisits).toBe(2);
    expect(j.avgCheck).toBe(250_000_00);
  });

  it("has no average check when no visit is paid, or payments are not recorded", () => {
    expect(
      computePatientJourney({ visits: [visit("p1")], returningPatientIds: [], paymentsTracked: true })
        .avgCheck,
    ).toBeNull();
    const untracked = computePatientJourney({
      visits: [visit("p1", 150_000_00)],
      returningPatientIds: [],
      paymentsTracked: false,
    });
    expect(untracked.avgCheck).toBeNull();
    expect(untracked.paidVisits).toBe(0);
  });
});

describe("loadPatientJourney: the queries behind each number", () => {
  const from = new Date("2026-09-21T19:00:00Z");
  const to = new Date("2026-09-28T19:00:00Z");

  function fakeDb() {
    const calls: Array<Record<string, unknown>> = [];
    const db = {
      appointment: {
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          calls.push(args);
          return calls.length === 1
            ? [
                { patientId: "p1", payments: [{ amount: 100 }, { amount: 50 }] },
                { patientId: "p2", payments: [] },
              ]
            : [{ patientId: "p2" }];
        }),
      },
    };
    return { db: db as unknown as JourneyDb, calls };
  }

  it("reads the window's completed visits, then who came before it", async () => {
    const { db, calls } = fakeDb();
    const j = await loadPatientJourney(db, { from, to, doctorId: null, paymentsTracked: true });

    expect(calls[0].where).toEqual({
      status: "COMPLETED",
      date: { gte: from, lt: to },
      patient: { deletedAt: null },
    });
    expect(calls[0].select).toMatchObject({
      payments: { where: { status: "PAID" }, select: { amount: true } },
    });
    expect(calls[1]).toMatchObject({
      where: {
        status: "COMPLETED",
        date: { lt: from },
        patientId: { in: ["p1", "p2"] },
      },
      distinct: ["patientId"],
    });
    expect(j).toMatchObject({
      visits: 2,
      newPatients: 1,
      repeatVisits: 1,
      paidVisits: 1,
      avgCheck: 150,
    });
  });

  it("scopes both queries to the doctor", async () => {
    const { db, calls } = fakeDb();
    await loadPatientJourney(db, { from, to, doctorId: "doc_1", paymentsTracked: false });
    expect((calls[0].where as Record<string, unknown>).doctorId).toBe("doc_1");
    expect((calls[1].where as Record<string, unknown>).doctorId).toBe("doc_1");
  });

  it("skips the history query when nobody came", async () => {
    const calls: unknown[] = [];
    const db = {
      appointment: {
        findMany: vi.fn(async (args: unknown) => {
          calls.push(args);
          return [];
        }),
      },
    } as unknown as JourneyDb;
    const j = await loadPatientJourney(db, { from, to, doctorId: null, paymentsTracked: false });
    expect(calls).toHaveLength(1);
    expect(j.visits).toBe(0);
  });
});

describe("GET /api/crm/analytics/journey", () => {
  it("returns the counted strip for the clinic, money only when payments are recorded", async () => {
    state.windowRows = [
      { patientId: "p1", payments: [] },
      { patientId: "p2", payments: [{ amount: 200 }] },
    ];
    state.priorRows = [{ patientId: "p2" }];
    const { GET } = await import("@/app/api/crm/analytics/journey/route");

    let res = await GET(new Request("https://x/api/crm/analytics/journey?period=week"));
    expect(res.status).toBe(200);
    let body = (await res.json()) as { doctorOnly: boolean; journey: Record<string, unknown> };
    expect(body.doctorOnly).toBe(false);
    expect(body.journey).toMatchObject({
      paymentsTracked: false,
      visits: 2,
      newPatients: 1,
      repeatVisits: 1,
      avgCheck: null,
    });

    state.trackedSince = new Date("2026-01-01T00:00:00Z");
    res = await GET(new Request("https://x/api/crm/analytics/journey?period=week"));
    body = (await res.json()) as typeof body;
    expect(body.journey).toMatchObject({ paymentsTracked: true, avgCheck: 200 });
  });

  it("gives a DOCTOR only their own visits", async () => {
    state.role = "DOCTOR";
    state.doctorRow = { id: "doc_1" };
    const { GET } = await import("@/app/api/crm/analytics/journey/route");
    const res = await GET(new Request("https://x/api/crm/analytics/journey?period=month"));
    const body = (await res.json()) as { doctorOnly: boolean };
    expect(body.doctorOnly).toBe(true);
    expect((state.findManyArgs[0].where as Record<string, unknown>).doctorId).toBe("doc_1");
  });

  it("gives a DOCTOR login with no Doctor row an empty strip, not the clinic's", async () => {
    state.role = "DOCTOR";
    state.doctorRow = null;
    state.windowRows = [{ patientId: "p1", payments: [] }];
    const { GET } = await import("@/app/api/crm/analytics/journey/route");
    const res = await GET(new Request("https://x/api/crm/analytics/journey?period=week"));
    const body = (await res.json()) as { journey: Record<string, unknown> };
    expect(body.journey).toEqual(EMPTY_JOURNEY);
    expect(state.findManyArgs).toHaveLength(0);
  });

  it("is closed to the desk", async () => {
    state.role = "RECEPTIONIST";
    const { GET } = await import("@/app/api/crm/analytics/journey/route");
    const res = await GET(new Request("https://x/api/crm/analytics/journey"));
    expect(res.status).toBe(403);
  });
});

describe("the strip itself", () => {
  const root = path.resolve(__dirname, "../..");
  const strip = readFileSync(
    path.join(root, "src/app/[locale]/crm/analytics/_components/journey-strip.tsx"),
    "utf8",
  );
  const code = strip.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("has no invented coefficients and derives nothing from appointment statuses", () => {
    expect(code).not.toMatch(/0\.62|0\.76/);
    expect(code).not.toContain("appointmentsByStatus");
    expect(code).not.toContain("openCasesTotal");
    expect(code).not.toContain("repeatConvPct");
  });

  it("no longer has the cases endpoint that fed it", () => {
    expect(existsSync(path.join(root, "src/app/api/crm/analytics/cases/route.ts"))).toBe(false);
  });

  it("has its labels in both languages, without dashes", async () => {
    const ru = (await import("@/messages/ru.json")).default as unknown as {
      analyticsDashboard: { journey: Record<string, string> };
    };
    const uz = (await import("@/messages/uz.json")).default as unknown as typeof ru;
    const keys = [
      "title",
      "newPatients",
      "visits",
      "repeatVisits",
      "repeatPct",
      "avgCheck",
      "revenue",
      "noPayments",
      "noPaidVisits",
      "hint",
      "hintDoctor",
    ];
    for (const msgs of [ru, uz]) {
      const j = msgs.analyticsDashboard.journey;
      expect(Object.keys(j).sort()).toEqual([...keys].sort());
      for (const k of keys) {
        expect(j[k]).toBeTruthy();
        expect(j[k]).not.toMatch(/[—–]/);
      }
    }
    // The strip no longer reads medical cases.
    expect(ru.analyticsDashboard.journey.title).toBe("Путь пациента");
  });
});
