/**
 * Audit ST-09 and CM-16: date filters of the audit log, the PHI-access log
 * and the documents library are Tashkent days, both ends inclusive.
 *
 * `z.coerce.date()` / `new Date("2026-09-23")` made UTC midnight of the
 * typed day, 05:00 in Tashkent. Used as `lte` it dropped the whole last day
 * (a one-day filter «с 23.09 по 23.09» was always empty); used as `gte` it
 * skipped the first five hours of the first day.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auditWhere: null as Record<string, unknown> | null,
  viewWhere: null as Record<string, unknown> | null,
  docWhere: null as Record<string, unknown> | null,
  audited: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" };
  return {
    createApiHandler:
      (_o: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, body: undefined, ctx }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, input: Record<string, unknown>) => {
    h.audited.push(input);
  }),
}));
vi.mock("@/lib/storage-ref", () => ({ withStaffFileUrl: (r: unknown) => r }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.auditWhere = where;
        return [];
      }),
    },
    patientView: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.viewWhere = where;
        return [];
      }),
    },
    patient: { findMany: vi.fn(async () => []) },
    document: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.docWhere = where;
        return [];
      }),
    },
    doctor: { findFirst: vi.fn(async () => null) },
    $queryRawUnsafe: vi.fn(async () => []),
  },
}));

import { isTashkentDateString, tashkentDayRange } from "@/lib/tashkent-time";
import { GET as auditGet } from "@/app/api/crm/audit/route";
import { GET as patientViewsGet } from "@/app/api/crm/audit/patient-views/route";
import { GET as documentsGet } from "@/app/api/crm/documents/route";

const DAY_START = new Date("2026-09-22T19:00:00.000Z"); // 23.09 00:00 Tashkent
const NEXT_DAY_START = new Date("2026-09-23T19:00:00.000Z"); // 24.09 00:00

beforeEach(() => {
  h.auditWhere = null;
  h.viewWhere = null;
  h.docWhere = null;
  h.audited = [];
});

describe("tashkentDayRange", () => {
  it("a one-day filter covers that whole Tashkent day", () => {
    expect(tashkentDayRange("2026-09-23", "2026-09-23")).toEqual({
      gte: DAY_START,
      lt: NEXT_DAY_START,
    });
  });

  it("23:59 Tashkent on the last day is inside, 00:00 of the next is not", () => {
    const r = tashkentDayRange("2026-09-01", "2026-09-15")!;
    const lastMinute = new Date("2026-09-15T23:59:00+05:00");
    const nextMidnight = new Date("2026-09-16T00:00:00+05:00");
    const firstHour = new Date("2026-09-01T00:30:00+05:00");
    expect(lastMinute < r.lt!).toBe(true);
    expect(nextMidnight < r.lt!).toBe(false);
    expect(firstHour >= r.gte!).toBe(true);
  });

  it("open ends stay open; nothing set means no filter", () => {
    expect(tashkentDayRange("2026-09-23", undefined)).toEqual({ gte: DAY_START });
    expect(tashkentDayRange(null, "2026-09-23")).toEqual({ lt: NEXT_DAY_START });
    expect(tashkentDayRange(undefined, undefined)).toBeNull();
  });

  it("only real calendar days pass the shape check", () => {
    expect(isTashkentDateString("2026-09-23")).toBe(true);
    expect(isTashkentDateString("2026-02-30")).toBe(false);
    expect(isTashkentDateString("2026-9-3")).toBe(false);
    expect(isTashkentDateString("2026-09-23T00:00:00Z")).toBe(false);
  });
});

describe("GET /api/crm/audit (ST-09)", () => {
  it("filters by Tashkent day bounds, the last day included", async () => {
    const res = await auditGet(
      new Request("https://x/api/crm/audit?from=2026-09-23&to=2026-09-23"),
    );
    expect(res.status).toBe(200);
    expect(h.auditWhere).toMatchObject({
      clinicId: "c1",
      createdAt: { gte: DAY_START, lt: NEXT_DAY_START },
    });
    expect((h.auditWhere!.createdAt as Record<string, unknown>).lte).toBeUndefined();
  });

  it("rejects a value that is not a calendar day", async () => {
    const res = await auditGet(new Request("https://x/api/crm/audit?from=2026-13-01"));
    expect(res.status).toBe(400);
    expect(h.auditWhere).toBeNull();
  });
});

describe("GET /api/crm/audit/patient-views (ST-09)", () => {
  it("uses the same inclusive Tashkent days and audits the filter as typed", async () => {
    const res = await patientViewsGet(
      new Request("https://x/api/crm/audit/patient-views?from=2026-09-23&to=2026-09-23"),
    );
    expect(res.status).toBe(200);
    expect(h.viewWhere).toMatchObject({
      createdAt: { gte: DAY_START, lt: NEXT_DAY_START },
    });
    const meta = h.audited[0]!.meta as { filters: Record<string, unknown> };
    expect(meta.filters).toMatchObject({ from: "2026-09-23", to: "2026-09-23" });
  });
});

describe("GET /api/crm/documents (CM-16)", () => {
  it("a one-day filter returns that Tashkent day, not an empty range", async () => {
    const res = await documentsGet(
      new Request("https://x/api/crm/documents?from=2026-09-23&to=2026-09-23"),
    );
    expect(res.status).toBe(200);
    expect(h.docWhere).toMatchObject({
      createdAt: { gte: DAY_START, lt: NEXT_DAY_START },
    });
  });

  it("garbage dates are a 400, not an Invalid Date handed to Prisma", async () => {
    const res = await documentsGet(new Request("https://x/api/crm/documents?to=yesterday"));
    expect(res.status).toBe(400);
    expect(h.docWhere).toBeNull();
  });
});
