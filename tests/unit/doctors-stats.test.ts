import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit DR-01: the doctors page and the doctor profile tabs asked
 * `GET /api/crm/appointments` for `limit=500`; the API caps it at 200 and
 * answered 400 on every load, which the pages rendered as zeros (revenue 0,
 * load 0 %, empty heat grid, no patients). Aggregates now come from a grouped
 * stats endpoint, raw rows are read page by page within the cap, and a failed
 * load shows as an error.
 */

const state = vi.hoisted(() => ({
  groupBy: [] as Array<Record<string, unknown>>,
  ownDoctor: null as null | { id: string },
  role: "ADMIN",
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: state.role },
      }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => state.ownDoctor) },
    appointment: {
      groupBy: vi.fn(async (args: { by: string[]; _sum?: Record<string, boolean> }) => {
        state.groupBy.push(args);
        if (args._sum?.priceService) {
          // One COMPLETED visit of d1 with no priceFinal: 200 000 − 50 000.
          return [{ doctorId: "d1", _sum: { priceService: 200_000, discountAmount: 50_000 } }];
        }
        if (args.by.includes("status")) {
          return [
            { doctorId: "d1", status: "COMPLETED", _count: { _all: 3 }, _sum: { priceFinal: 900_000 } },
            { doctorId: "d1", status: "NO_SHOW", _count: { _all: 1 }, _sum: { priceFinal: 300_000 } },
            { doctorId: "d1", status: "CANCELLED", _count: { _all: 1 }, _sum: { priceFinal: 0 } },
            { doctorId: "d2", status: "BOOKED", _count: { _all: 2 }, _sum: { priceFinal: 400_000 } },
          ];
        }
        return [{ doctorId: "d2", _count: { _all: 2 } }];
      }),
    },
  },
}));

import { QueryAppointmentSchema } from "@/server/schemas/appointment";
import {
  APPOINTMENTS_LIST_MAX_LIMIT,
  fetchAllAppointmentPages,
} from "@/lib/appointments/fetch-all-pages";
import { foldDoctorStats } from "@/server/doctors/stats";

beforeEach(() => {
  state.groupBy = [];
  state.ownDoctor = null;
  state.role = "ADMIN";
});

describe("the list API cap", () => {
  it("the page size the clients use is accepted; 500 is not", () => {
    expect(
      QueryAppointmentSchema.safeParse({ limit: String(APPOINTMENTS_LIST_MAX_LIMIT) }).success,
    ).toBe(true);
    expect(QueryAppointmentSchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("no client asks /api/crm/appointments for more than the cap", () => {
    const root = path.resolve(__dirname, "../../src/app");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "api") walk(p);
          continue;
        }
        if (!/\.(tsx?|ts)$/.test(name)) continue;
        const src = readFileSync(p, "utf8");
        if (!src.includes("/api/crm/appointments?")) continue;
        for (const m of src.matchAll(/limit["']?\s*[:=,]\s*["']?(\d+)/g)) {
          if (Number(m[1]) > APPOINTMENTS_LIST_MAX_LIMIT) offenders.push(`${p}: ${m[0]}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("fetchAllAppointmentPages", () => {
  it("pages through nextCursor with limit = cap", async () => {
    const urls: string[] = [];
    const pages: Record<string, { rows: number[]; nextCursor: string | null }> = {
      "": { rows: [1, 2], nextCursor: "c2" },
      c2: { rows: [3], nextCursor: "c3" },
      c3: { rows: [4], nextCursor: null },
    };
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      const cursor = new URL(url, "https://x").searchParams.get("cursor") ?? "";
      return new Response(JSON.stringify(pages[cursor]), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await fetchAllAppointmentPages<number>({ doctorId: "d1" }, { fetchImpl });
    expect(res).toEqual({ rows: [1, 2, 3, 4], truncated: false });
    for (const u of urls) {
      expect(new URL(u, "https://x").searchParams.get("limit")).toBe(
        String(APPOINTMENTS_LIST_MAX_LIMIT),
      );
    }
  });

  it("a refused page is an error, never an empty result", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    await expect(fetchAllAppointmentPages({}, { fetchImpl })).rejects.toThrow("HTTP 400");
  });

  it("stops at the page budget and says the result is truncated", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ rows: [1], nextCursor: "more" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const res = await fetchAllAppointmentPages<number>({}, { fetchImpl, maxPages: 3 });
    expect(res).toEqual({ rows: [1, 1, 1], truncated: true });
  });
});

describe("doctor stats", () => {
  it("folds grouped rows: revenue is Σ priceFinal of COMPLETED only", () => {
    const rows = foldDoctorStats(
      [
        { doctorId: "d1", status: "COMPLETED", _count: { _all: 3 }, _sum: { priceFinal: 900_000 } },
        { doctorId: "d1", status: "NO_SHOW", _count: { _all: 1 }, _sum: { priceFinal: 300_000 } },
        { doctorId: "d1", status: "CANCELLED", _count: { _all: 2 }, _sum: { priceFinal: null } },
      ],
      [{ doctorId: "d1", _count: { _all: 2 } }],
    );
    expect(rows).toEqual([
      {
        doctorId: "d1",
        total: 6,
        completed: 3,
        noShow: 1,
        cancelled: 2,
        revenue: 900_000,
        todayCount: 2,
      },
    ]);
  });

  it("GET /api/crm/doctors/stats returns real numbers for the period", async () => {
    const { GET } = await import("@/app/api/crm/doctors/stats/route");
    const res = await GET(
      new Request(
        "https://x/api/crm/doctors/stats?from=2026-09-01T00:00:00.000Z&to=2026-09-25T18:59:59.999Z",
      ),
    );
    expect(res.status).toBe(200);
    const { rows } = (await res.json()) as {
      rows: Array<{ doctorId: string; revenue: number; completed: number; todayCount: number }>;
    };
    const d1 = rows.find((r) => r.doctorId === "d1")!;
    // Like the analytics rollup: priceFinal, else service − discount.
    expect(d1).toMatchObject({ completed: 3, revenue: 900_000 + 150_000 });
    expect(rows.find((r) => r.doctorId === "d2")!.todayCount).toBe(2);
    const where = state.groupBy[0]!.where as { date: { gte: Date; lte: Date } };
    expect(where.date.gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("a doctor only ever gets their own row", async () => {
    state.role = "DOCTOR";
    state.ownDoctor = { id: "d1" };
    const { GET } = await import("@/app/api/crm/doctors/stats/route");

    await GET(new Request("https://x/api/crm/doctors/stats"));
    expect(state.groupBy[0]!.where).toMatchObject({ doctorId: "d1" });

    state.groupBy = [];
    const other = await GET(new Request("https://x/api/crm/doctors/stats?doctorId=d2"));
    expect((await other.json()).rows).toEqual([]);
    expect(state.groupBy).toHaveLength(0);
  });
});
