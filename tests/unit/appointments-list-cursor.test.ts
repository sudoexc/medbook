import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Review of DR-01: GET /api/crm/appointments fetched limit+1 rows, popped the
 * look-ahead row and sent ITS id as `nextCursor`. The next request reads with
 * `cursor: {id}, skip: 1`, which skipped exactly that never-returned row, so
 * every page boundary lost one appointment. The full-range readers
 * (fetchAllAppointmentPages: doctors' today board, heat grid, patients tab;
 * the calendar) under-counted on anything past 200 rows.
 *
 * The real route runs here over an in-memory table whose `findMany` follows
 * Prisma's cursor semantics (order, find the cursor row, skip, take). Rows the
 * `orderBy` leaves tied come back in a different order on every call, like
 * Postgres is free to do, so a cursor over a non-total order shows up too.
 */

type Row = { id: string; date: Date; createdAt: Date; doctorId: string };

const table = vi.hoisted(() => ({ rows: [] as Row[], calls: 0 }));

type OrderBy = Array<Record<string, "asc" | "desc">> | Record<string, "asc" | "desc">;

function cmpField(a: Row, b: Row, field: string): number {
  const av = (a as Record<string, unknown>)[field];
  const bv = (b as Record<string, unknown>)[field];
  if (av instanceof Date && bv instanceof Date) return av.getTime() - bv.getTime();
  return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
}

/** A per-call tie order: stable within one query, different between queries. */
function tieKey(id: string, call: number): number {
  let h = call * 2654435761;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(
        async (args: {
          where: { doctorId?: string };
          orderBy: OrderBy;
          take: number;
          skip?: number;
          cursor?: { id: string };
        }) => {
          table.calls += 1;
          const call = table.calls;
          const order = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
          const sorted = table.rows
            .filter((r) => !args.where.doctorId || r.doctorId === args.where.doctorId)
            .sort((a, b) => {
              for (const o of order) {
                const [field, dir] = Object.entries(o)[0]!;
                const c = cmpField(a, b, field);
                if (c !== 0) return dir === "asc" ? c : -c;
              }
              return tieKey(a.id, call) - tieKey(b.id, call);
            });
          let start = 0;
          if (args.cursor) {
            start = sorted.findIndex((r) => r.id === args.cursor!.id);
            if (start < 0) return [];
          }
          start += args.skip ?? 0;
          return sorted.slice(start, start + args.take).map((r) => ({ ...r }));
        },
      ),
      count: vi.fn(async () => table.rows.length),
      groupBy: vi.fn(async () => []),
    },
  },
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" },
      }),
  createApiHandler: () => async () => new Response(null, { status: 405 }),
}));
vi.mock("@/server/appointments/book", () => ({ bookAppointment: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({ newCorrelationId: () => "corr" }));

import { GET } from "@/app/api/crm/appointments/route";
import { fetchAllAppointmentPages } from "@/lib/appointments/fetch-all-pages";

/** `fetch` that serves `/api/crm/appointments?…` from the real route. */
const routeFetch = (async (url: string) =>
  GET(new Request(`https://clinic.test${url}`))) as unknown as typeof fetch;

/**
 * `n` visits in 30-minute slots, five doctors per slot, so most start times
 * are shared by several rows (the tie the `id` tiebreaker has to settle).
 */
function seed(n: number) {
  const t0 = Date.parse("2026-07-01T04:00:00Z");
  table.rows = Array.from({ length: n }, (_, i) => {
    const slot = Math.floor(i / 5);
    // Ids not in slot order, so id order and date order disagree.
    const id = `appt_${((i * 7919) % 100_003).toString().padStart(6, "0")}_${i}`;
    return {
      id,
      date: new Date(t0 + slot * 30 * 60_000),
      createdAt: new Date(t0 - (n - i) * 60_000),
      doctorId: `d${i % 5}`,
    };
  });
}

beforeEach(() => {
  table.rows = [];
  table.calls = 0;
});

describe("GET /api/crm/appointments cursor paging", () => {
  it("401 visits read page by page come back as 401 distinct visits", async () => {
    seed(401);
    const { rows, truncated } = await fetchAllAppointmentPages<{ id: string }>(
      { sort: "date", dir: "asc" },
      { fetchImpl: routeFetch },
    );
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(401);
    expect(new Set(rows.map((r) => r.id)).size).toBe(401);
    // 200 + 200 + 1: three pages, no extra empty round trip.
    expect(table.calls).toBe(3);
  });

  it("descending order and the createdAt sort page without loss too", async () => {
    seed(450);
    for (const params of [
      { sort: "date", dir: "desc" },
      { sort: "createdAt", dir: "asc" },
    ]) {
      const { rows } = await fetchAllAppointmentPages<{ id: string; date: string }>(params, {
        fetchImpl: routeFetch,
      });
      expect(new Set(rows.map((r) => r.id)).size).toBe(450);
      if (params.sort === "date") {
        const times = rows.map((r) => Date.parse(r.date));
        expect(times).toEqual([...times].sort((a, b) => b - a));
      }
    }
  });

  it("nextCursor is the last row the page returned, and the last page has none", async () => {
    seed(5);
    const first = await (await routeFetch("/api/crm/appointments?limit=3")).json();
    expect(first.rows).toHaveLength(3);
    expect(first.nextCursor).toBe(first.rows[2].id);

    const second = await (
      await routeFetch(`/api/crm/appointments?limit=3&cursor=${first.nextCursor}`)
    ).json();
    expect(second.rows).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it("orders by the requested field with id as the tiebreaker", async () => {
    seed(3);
    await routeFetch("/api/crm/appointments?sort=date&dir=desc");
    const { prisma } = await import("@/lib/prisma");
    const call = vi.mocked(prisma.appointment.findMany).mock.calls.at(-1)![0] as {
      orderBy: unknown;
    };
    expect(call.orderBy).toEqual([{ date: "desc" }, { id: "desc" }]);
  });
});
