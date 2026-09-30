/**
 * Audit DC-11 — the conclusions list was ordered by `updatedAt` and paged
 * by an id cursor. An autosave or a handout re-render moved a row between
 * two pages (a duplicate, or a row never shown), an old conclusion jumped to
 * the top after a small fix, and the next-page cursor was the first row not
 * sent, so every page lost one conclusion.
 *
 * Pinned: signed conclusions by signing time, drafts by opening time, the
 * id breaking ties; a keyset cursor from the last row sent. Paging the
 * route over a fixture while notes are edited in between returns every
 * conclusion exactly once, in that order.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeListCursor,
  encodeListCursor,
  keysetAfter,
  listOrderBy,
  listSortField,
} from "@/server/visit-notes/list-order";

type Note = {
  id: string;
  status: "DRAFT" | "FINALIZED";
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const state = {
  notes: [] as Note[],
  calls: [] as Array<Record<string, unknown>>,
};

type Clause = Record<string, unknown>;

/** Just enough of Postgres to run the route's where on the fixture. */
function matches(n: Note, c: Clause): boolean {
  return Object.entries(c).every(([k, v]) => {
    if (k === "OR") return (v as Clause[]).some((x) => matches(n, x));
    if (k === "AND") return (v as Clause[]).every((x) => matches(n, x));
    if (k === "NOT") return true; // cancelled drafts: none in the fixture
    const field = n[k as keyof Note];
    if (v === null) return field === null;
    if (v instanceof Date) return field instanceof Date && field.getTime() === v.getTime();
    if (typeof v === "string") return field === v;
    const op = v as { lt?: Date | string };
    if (op.lt === undefined) return true;
    if (field === null) return false;
    return op.lt instanceof Date
      ? (field as Date).getTime() < op.lt.getTime()
      : (field as string) < op.lt;
  });
}

function sortBy(field: "finalizedAt" | "createdAt") {
  return (a: Note, b: Note) => {
    const av = a[field]?.getTime() ?? null;
    const bv = b[field]?.getTime() ?? null;
    if (av !== bv) {
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  };
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
    visitNote: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.notes.find((n) => n.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async (args: {
          where: Clause & { status?: string };
          orderBy: Array<Record<string, unknown>>;
          take: number;
        }) => {
          state.calls.push(args as never);
          const field = Object.keys(args.orderBy[0]!)[0] as "finalizedAt" | "createdAt";
          const { status, doctorId: _d, ...rest } = args.where;
          return state.notes
            .filter((n) => (!status || n.status === status) && matches(n, rest))
            .sort(sortBy(field))
            .slice(0, args.take)
            .map((n) => ({ ...n }));
        },
      ),
    },
  },
}));

const at = (min: number) => new Date(Date.UTC(2026, 8, 20, 9, min));

beforeEach(() => {
  state.calls = [];
  // Two signed at the same minute (the tie), one legacy row with no time.
  state.notes = [
    { id: "n1", status: "FINALIZED", finalizedAt: at(10), createdAt: at(1), updatedAt: at(50) },
    { id: "n2", status: "FINALIZED", finalizedAt: at(20), createdAt: at(2), updatedAt: at(21) },
    { id: "n3", status: "FINALIZED", finalizedAt: at(20), createdAt: at(3), updatedAt: at(22) },
    { id: "n4", status: "FINALIZED", finalizedAt: at(30), createdAt: at(4), updatedAt: at(31) },
    { id: "n5", status: "FINALIZED", finalizedAt: at(40), createdAt: at(5), updatedAt: at(41) },
    { id: "n6", status: "FINALIZED", finalizedAt: null, createdAt: at(6), updatedAt: at(7) },
    { id: "d1", status: "DRAFT", finalizedAt: null, createdAt: at(8), updatedAt: at(60) },
    { id: "d2", status: "DRAFT", finalizedAt: null, createdAt: at(9), updatedAt: at(9) },
  ];
});

async function get(qs: string) {
  const { GET } = await import("@/app/api/crm/visit-notes/route");
  const res = await GET(new Request(`https://x/api/crm/visit-notes?${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as { rows: Note[]; nextCursor: string | null };
}

/** Scroll to the end, touching notes between pages like autosave does. */
async function scroll(status: string, touch: (page: number) => void) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ status, limit: "2" });
    if (cursor) qs.set("cursor", cursor);
    const body = await get(qs.toString());
    ids.push(...body.rows.map((r) => r.id));
    touch(page);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

describe("the conclusions list order", () => {
  it("signed: by signing time, id breaking ties, legacy last", async () => {
    const ids = await scroll("FINALIZED", () => undefined);
    expect(ids).toEqual(["n5", "n4", "n3", "n2", "n1", "n6"]);
    expect(state.calls[0]!.orderBy).toEqual(listOrderBy("finalizedAt"));
  });

  it("no duplicates and no gaps while notes change under the doctor", async () => {
    const ids = await scroll("FINALIZED", (page) => {
      // A handout re-render and an in-window fix between pages: the old
      // order by updatedAt reshuffled exactly these.
      for (const n of state.notes) n.updatedAt = new Date(at(59).getTime() + page);
    });
    expect(ids).toEqual(["n5", "n4", "n3", "n2", "n1", "n6"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drafts: by when they were opened", async () => {
    expect(await scroll("DRAFT", () => undefined)).toEqual(["d2", "d1"]);
    expect(state.calls[0]!.orderBy).toEqual(listOrderBy("createdAt"));
  });

  it("the cursor is the last row sent", async () => {
    const body = await get("status=FINALIZED&limit=2");
    expect(body.rows.map((r) => r.id)).toEqual(["n5", "n4"]);
    expect(body.nextCursor).toBe(encodeListCursor(at(30), "n4"));
  });

  it("a page loaded before the change still continues", async () => {
    const ids = (await get("status=FINALIZED&limit=2&cursor=n4")).rows.map((r) => r.id);
    expect(ids).toEqual(["n3", "n2"]);
    // A cursor that points nowhere ends the list instead of restarting it.
    expect((await get("status=FINALIZED&limit=2&cursor=gone")).rows).toEqual([]);
  });
});

describe("the helpers", () => {
  it("sorts signed notes by signing time, the rest by opening", () => {
    expect(listSortField("FINALIZED")).toBe("finalizedAt");
    expect(listSortField("DRAFT")).toBe("createdAt");
    expect(listSortField(undefined)).toBe("createdAt");
  });

  it("round-trips the cursor", () => {
    expect(decodeListCursor(encodeListCursor(at(5), "abc"))).toEqual({ value: at(5), id: "abc" });
    expect(decodeListCursor(encodeListCursor(null, "abc"))).toEqual({ value: null, id: "abc" });
    expect(decodeListCursor("abc")).toEqual({ id: "abc" });
    expect(decodeListCursor("x1:abc")).toBeNull();
    expect(decodeListCursor("")).toBeNull();
  });

  it("after a null value, only nulls with a smaller id", () => {
    expect(keysetAfter("finalizedAt", { value: null, id: "n6" })).toEqual({
      finalizedAt: null,
      id: { lt: "n6" },
    });
  });

  it("gives the NOT NULL createdAt a bare direction and no null branch", () => {
    // Prisma rejects `{ sort, nulls }` and `{ createdAt: null }` on a
    // required column (the drafts tab answered 500); see
    // conclusions-list-prisma.test.ts for the check against the client.
    expect(listOrderBy("createdAt")).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(keysetAfter("createdAt", { value: at(5), id: "d1" })).toEqual({
      OR: [{ createdAt: { lt: at(5) } }, { createdAt: at(5), id: { lt: "d1" } }],
    });
    // No draft has a null createdAt, so such a cursor cannot be placed.
    expect(keysetAfter("createdAt", { value: null, id: "d1" })).toBeNull();
  });
});
