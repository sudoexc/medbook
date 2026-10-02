/**
 * Audit G1-11 — downloading a finished CSV export (a copy of the clinic's
 * patient base) leaves an audit row each time, so who took it and how often
 * is on record. A download that serves nothing writes nothing.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  audits: [] as Array<{
    action: string;
    entityType: string;
    entityId?: string | null;
    meta?: Record<string, unknown>;
  }>,
  job: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_admin", role: "ADMIN", clinicId: "c1", email: "a@example.test" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_admin", role: "ADMIN" }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, input: (typeof h.audits)[number]) => {
    h.audits.push(input);
  }),
}));
vi.mock("@/server/workers/exports", () => ({
  getExport: vi.fn(() => h.job),
}));

const dir = mkdtempSync(path.join(tmpdir(), "g1-11-"));
const csv = path.join(dir, "job_1.csv");
writeFileSync(csv, "id,fullName\n1,Test\n");

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job_1",
    kind: "patients",
    filters: {},
    status: "done",
    requestedBy: "u_admin",
    clinicId: "c1",
    rowCount: 1,
    filePath: csv,
    fileSize: 20,
    ...overrides,
  };
}

async function download(): Promise<Response> {
  const { GET } = await import("@/app/api/crm/exports/[jobId]/download/route");
  return GET(new Request("https://x/api/crm/exports/job_1/download"));
}

beforeEach(() => {
  h.audits = [];
  h.job = job();
});

describe("GET /api/crm/exports/[jobId]/download", () => {
  it("records every download served", async () => {
    const first = await download();
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("fullName");
    await download();
    expect(h.audits).toHaveLength(2);
    expect(h.audits[0]).toMatchObject({
      action: "CRM_EXPORT_DOWNLOADED",
      entityType: "ExportJob",
      entityId: "job_1",
      meta: { kind: "patients", rowCount: 1 },
    });
  });

  it("writes nothing when no file leaves", async () => {
    h.job = job({ status: "running", filePath: null });
    expect((await download()).status).toBe(409);
    h.job = job({ filePath: path.join(dir, "swept.csv") });
    expect((await download()).status).toBe(404);
    h.job = job({ clinicId: "c2" });
    expect((await download()).status).toBe(404);
    h.job = null;
    expect((await download()).status).toBe(404);
    expect(h.audits).toEqual([]);
  });
});
