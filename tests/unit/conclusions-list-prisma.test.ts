/**
 * Review of DC-11: the conclusions list's order and keyset were checked
 * against a mocked prisma that accepts any shape, and the «Черновики» tab
 * shipped broken. Drafts sort by `createdAt`, a NOT NULL column, and Prisma
 * accepts only a bare direction there: `{ sort, nulls }` and a
 * `{ createdAt: null }` branch fail validation before the query reaches the
 * database, so the route answered 500 and the doctor's unsigned work never
 * loaded.
 *
 * Here the route runs on the generated client over a stub driver adapter.
 * Validation and query compilation are the real ones; the adapter only
 * records the SQL and answers with no rows. A query that reaches the adapter
 * passed validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ColumnTypeEnum,
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlQuery,
  type SqlResultSet,
} from "@prisma/driver-adapter-utils";

import { PrismaClient } from "@/generated/prisma/client";
import { encodeListCursor } from "@/server/visit-notes/list-order";

const state = vi.hoisted(() => ({
  role: "DOCTOR" as "DOCTOR" | "ADMIN",
  sql: [] as string[],
}));

function answer(q: SqlQuery): SqlResultSet {
  state.sql.push(q.sql);
  // The doctor lookup is the only query that must find a row: without it
  // the route returns an empty list before the query under test.
  if (/FROM "public"\."Doctor"/.test(q.sql)) {
    return { columnNames: ["id"], columnTypes: [ColumnTypeEnum.Text], rows: [["doc_1"]] };
  }
  return { columnNames: [], columnTypes: [], rows: [] };
}

const adapter: SqlDriverAdapter = {
  provider: "postgres",
  adapterName: "stub",
  queryRaw: async (q) => answer(q),
  executeRaw: async () => 0,
  executeScript: async () => undefined,
  startTransaction: async () => {
    throw new Error("no transactions in this test");
  },
  dispose: async () => undefined,
};

const factory: SqlDriverAdapterFactory = {
  provider: "postgres",
  adapterName: "stub",
  connect: async () => adapter,
};

vi.mock("@/lib/prisma", () => ({ prisma: new PrismaClient({ adapter: factory }) }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_1", role: state.role, clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT" as const, clinicId: "c1", userId: "u_1", role: state.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

beforeEach(() => {
  state.role = "DOCTOR";
  state.sql = [];
});

async function list(qs: string) {
  const { GET } = await import("@/app/api/crm/visit-notes/route");
  const res = await GET(new Request(`https://x/api/crm/visit-notes?${qs}`));
  const body = (await res.json()) as { rows?: unknown[]; nextCursor?: string | null };
  return { status: res.status, body };
}

/** The SQL of the list query itself, not the doctor lookup. */
function listSql(): string {
  const sql = state.sql.find((s) => /FROM "public"\."VisitNote"/.test(s));
  expect(sql, "the list query never reached the database").toBeDefined();
  return sql!;
}

const signedAt = new Date(Date.UTC(2026, 8, 20, 9, 30));

describe("the conclusions list passes Prisma's own validation", () => {
  it("drafts, first page: newest opened first", async () => {
    const { status, body } = await list("status=DRAFT&limit=20");
    expect(status).toBe(200);
    expect(body).toEqual({ rows: [], nextCursor: null });
    expect(listSql()).toMatch(/ORDER BY \S*"createdAt"\s*DESC, \S*"id"\s*DESC/);
  });

  it("drafts, next page: the keyset on createdAt", async () => {
    const cursor = encodeListCursor(signedAt, "vn_9");
    const { status } = await list(`status=DRAFT&limit=20&cursor=${cursor}`);
    expect(status).toBe(200);
    expect(listSql()).toMatch(/"createdAt"\s*<\s*\$\d+/);
  });

  it("signed, first page: legacy rows without a signing time last", async () => {
    const { status } = await list("status=FINALIZED&limit=20");
    expect(status).toBe(200);
    expect(listSql()).toMatch(/"finalizedAt"\s*DESC NULLS LAST/);
  });

  it("signed, next page, after a dated row and after a legacy one", async () => {
    for (const cursor of [encodeListCursor(signedAt, "vn_9"), encodeListCursor(null, "vn_9")]) {
      state.sql = [];
      const { status } = await list(`status=FINALIZED&limit=20&cursor=${cursor}`);
      expect(status, cursor).toBe(200);
      expect(listSql()).toMatch(/"finalizedAt" IS NULL/);
    }
  });

  it("the admin's unfiltered list, with a search term", async () => {
    state.role = "ADMIN";
    const cursor = encodeListCursor(signedAt, "vn_9");
    const { status } = await list(`q=${encodeURIComponent("мигрень")}&limit=20&cursor=${cursor}`);
    expect(status).toBe(200);
    expect(listSql()).toMatch(/ORDER BY \S*"createdAt"\s*DESC/);
  });

  it("a draft cursor without a value ends the list instead of failing", async () => {
    const { status, body } = await list(`status=DRAFT&limit=20&cursor=${encodeListCursor(null, "vn_9")}`);
    expect(status).toBe(200);
    expect(body).toEqual({ rows: [], nextCursor: null });
  });
});
