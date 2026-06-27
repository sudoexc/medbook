/**
 * POST /api/crm/appointments/reorder — honest no-op signal.
 *
 * Variant-A reorder rewrites the `queuedAt` anchor, but a booking whose slot is
 * still in the future floors at its slot (serveAt = max(slot, queuedAt)), so
 * dragging it earlier than its slot is a no-op. The route must report that
 * honestly (`exact`, `floored`, `effectiveOrder`) so the reception UI can snap
 * its optimistic state and suggest «срочно» instead of showing a bare success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  date: Date;
  queuedAt: Date | null;
  channel: string;
  queuePriority: number;
  ticketSeq: number | null;
};

const state = {
  rows: [] as Row[],
  updates: [] as Array<{ id: string; queuedAt: Date }>,
  publishes: [] as Array<{ type: string; payload: unknown }>,
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_recept", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.t" },
  })),
}));

vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_recept",
    role: "RECEPTIONIST" as const,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((_clinicId: string, ev: { type: string; payload: unknown }) => {
    state.publishes.push(ev);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        const wanted = new Set(where.id.in);
        return state.rows.filter((r) => wanted.has(r.id));
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { queuedAt: Date };
        }) => {
          state.updates.push({ id: where.id, queuedAt: data.queuedAt });
          return { id: where.id };
        },
      ),
    },
    $transaction: vi.fn(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(undefined),
    ),
  },
}));

async function loadPOST() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/appointments/reorder/route");
  return mod.POST as (req: Request) => Promise<Response>;
}

function postReq(body: unknown): Request {
  return new Request("https://x/api/crm/appointments/reorder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const NOW = new Date("2026-06-27T10:00:00.000Z");

function walkin(id: string, joinedAtMs: number, ticketSeq: number): Row {
  return {
    id,
    date: new Date(joinedAtMs),
    queuedAt: new Date(joinedAtMs),
    channel: "WALKIN",
    queuePriority: 0,
    ticketSeq,
  };
}

beforeEach(() => {
  state.rows = [];
  state.updates = [];
  state.publishes = [];
});

describe("POST /api/crm/appointments/reorder — honest signal", () => {
  it("all walk-ins: drag is exact, nothing floored", async () => {
    state.rows = [
      walkin("w1", NOW.getTime(), 1),
      walkin("w2", NOW.getTime() + 60_000, 2),
      walkin("w3", NOW.getTime() + 120_000, 3),
    ];
    const POST = await loadPOST();
    const res = await POST(
      postReq({ doctorId: "doc_1", orderedIds: ["w3", "w1", "w2"] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exact: boolean;
      floored: string[];
      effectiveOrder: string[];
    };
    expect(body.exact).toBe(true);
    expect(body.floored).toEqual([]);
    expect(body.effectiveOrder).toEqual(["w3", "w1", "w2"]);
  });

  it("future-slot booking dragged earlier than its slot floors → not exact", async () => {
    // b1 is a PHONE booking three hours out: its serveAt floors at the slot,
    // so dragging it to the top can't actually move it ahead of the walk-ins.
    state.rows = [
      walkin("w1", NOW.getTime(), 1),
      walkin("w2", NOW.getTime() + 60_000, 2),
      {
        id: "b1",
        date: new Date(NOW.getTime() + 3 * 60 * 60_000),
        queuedAt: null,
        channel: "PHONE",
        queuePriority: 0,
        ticketSeq: 3,
      },
    ];
    const POST = await loadPOST();
    const res = await POST(
      postReq({ doctorId: "doc_1", orderedIds: ["b1", "w1", "w2"] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exact: boolean;
      floored: string[];
      effectiveOrder: string[];
    };
    expect(body.exact).toBe(false);
    expect(body.floored).toEqual(["b1"]);
    // The booking sinks below the walk-ins it could not jump.
    expect(body.effectiveOrder).toEqual(["w1", "w2", "b1"]);
    // The write still happens — the floored row's anchor is harmless.
    expect(state.updates).toHaveLength(3);
  });
});
