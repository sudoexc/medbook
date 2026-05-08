/**
 * Phase 18 Wave 3 — POST /api/crm/analytics/reports contract tests.
 *
 * Mocks `auth` (TENANT ADMIN session) and `prisma.savedReport`. Asserts the
 * 422 / 409 / 201 paths the spec calls for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionRef = {
  current: {
    user: {
      id: "u_admin",
      role: "ADMIN" as const,
      clinicId: "c1",
      email: "admin@example.com",
    },
  } as unknown as object | null,
};

interface SavedRow {
  id: string;
  clinicId: string;
  name: string;
}

const state: { rows: SavedRow[]; nextId: number } = { rows: [], nextId: 1 };

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => sessionRef.current),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    savedReport: {
      count: vi.fn(async () => state.rows.length),
      findFirst: vi.fn(async (args: { where: { name?: string } }) => {
        if (args.where?.name) {
          return state.rows.find((r) => r.name === args.where.name) ?? null;
        }
        return state.rows[0] ?? null;
      }),
      create: vi.fn(async (args: { data: { name: string } }) => {
        const row: SavedRow = {
          id: `r_${state.nextId++}`,
          clinicId: "c1",
          name: args.data.name,
        };
        state.rows.push(row);
        return {
          ...row,
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastRunAt: null,
        };
      }),
    },
  },
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

beforeEach(() => {
  state.rows = [];
  state.nextId = 1;
  sessionRef.current = {
    user: {
      id: "u_admin",
      role: "ADMIN" as const,
      clinicId: "c1",
      email: "admin@example.com",
    },
  };
});

async function loadPost() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/analytics/reports/route");
  return mod.POST;
}

function req(body: unknown): Request {
  return new Request("https://x/api/crm/analytics/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_CONFIG = {
  version: 1,
  dimensions: ["doctor"],
  measures: ["count_visits"],
  filters: {},
};

describe("POST /api/crm/analytics/reports", () => {
  it("returns 422 on invalid report config", async () => {
    const POST = await loadPost();
    const res = await POST(
      req({ name: "x", config: { version: 1, dimensions: [], measures: [] } }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("InvalidReportConfig");
  });

  it("returns 409 on duplicate name", async () => {
    state.rows.push({ id: "r_existing", clinicId: "c1", name: "April" });
    const POST = await loadPost();
    const res = await POST(req({ name: "April", config: VALID_CONFIG }));
    expect(res.status).toBe(409);
  });

  it("returns 201 on a valid create", async () => {
    const POST = await loadPost();
    const res = await POST(req({ name: "Fresh", config: VALID_CONFIG }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^r_/);
    expect(body.name).toBe("Fresh");
  });

  it("rejects non-ADMIN with 403", async () => {
    sessionRef.current = {
      user: {
        id: "u_recep",
        role: "RECEPTIONIST" as const,
        clinicId: "c1",
        email: "rec@example.com",
      },
    };
    const POST = await loadPost();
    const res = await POST(req({ name: "x", config: VALID_CONFIG }));
    expect(res.status).toBe(403);
  });
});
