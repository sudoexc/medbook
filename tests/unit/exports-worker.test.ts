/**
 * Unit tests for the Phase 5 CSV export worker.
 *
 * We mock Prisma models (`patient`, `appointment`, `payment`) + the tenant
 * runner so `runWithTenant` is a pass-through. The worker writes to
 * `/tmp/exports/<jobId>.csv`; we read the bytes back and assert on:
 *
 *   1. registry lifecycle (pending → running → done)
 *   2. UTF-8 BOM prefix
 *   3. header + row quoting (commas, quotes, newlines)
 *   4. rowCount equals fed rows
 *   5. cursor-based pagination works for >500 rows
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// -- Mocks ------------------------------------------------------------------

const patientRows: Array<Record<string, unknown>> = [];
const appointmentRows: Array<Record<string, unknown>> = [];
const paymentRows: Array<Record<string, unknown>> = [];

function pageAfter(
  rows: Array<Record<string, unknown>>,
  cursorId: string | undefined,
  take: number,
): Array<Record<string, unknown>> {
  let startIdx = 0;
  if (cursorId) {
    const idx = rows.findIndex((r) => r.id === cursorId);
    startIdx = idx >= 0 ? idx + 1 : 0;
  }
  return rows.slice(startIdx, startIdx + take);
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findMany: vi.fn(
        async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
          return pageAfter(patientRows, args.cursor?.id, args.take);
        },
      ),
    },
    appointment: {
      findMany: vi.fn(
        async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
          return pageAfter(appointmentRows, args.cursor?.id, args.take);
        },
      ),
    },
    payment: {
      findMany: vi.fn(
        async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
          return pageAfter(paymentRows, args.cursor?.id, args.take);
        },
      ),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: vi.fn(async (_tenant: unknown, fn: () => Promise<unknown>) =>
    fn(),
  ),
}));

// Don't actually enqueue onto any shared singleton — we drive the worker
// synchronously via `__runExportForTests`.
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => undefined),
  getQueue: vi.fn(() => ({
    registerWorker: vi.fn(),
    enqueue: vi.fn(async () => undefined),
    repeat: vi.fn(() => ({ stop: () => undefined })),
    shutdown: vi.fn(async () => undefined),
  })),
}));

// Import AFTER mocks.
import {
  __resetExportRegistry,
  __runExportForTests,
  enqueueExport,
  getExport,
} from "@/server/workers/exports";

const TENANT = {
  kind: "TENANT" as const,
  clinicId: "clinic-a",
  userId: "user-1",
  role: "ADMIN" as const,
};

// -- Tests ------------------------------------------------------------------

describe("exports worker", () => {
  beforeEach(() => {
    __resetExportRegistry();
    patientRows.length = 0;
    appointmentRows.length = 0;
    paymentRows.length = 0;
  });

  afterEach(async () => {
    // Best-effort cleanup of /tmp/exports files.
    try {
      const dir = path.join("/tmp", "exports");
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.endsWith(".csv")) {
          await fs.unlink(path.join(dir, f)).catch(() => undefined);
        }
      }
    } catch {
      /* ignore */
    }
  });

  it("creates a pending job on enqueue and transitions to done after run", async () => {
    patientRows.push({
      id: "p1",
      fullName: "Alice",
      phone: "+998900000001",
      gender: "F",
      birthDate: null,
      segment: "ACTIVE",
      source: "ORGANIC",
      ltv: 1000,
      visitsCount: 2,
      balance: 0,
      lastVisitAt: null,
      tags: ["vip"],
      createdAt: new Date("2026-04-01"),
    });

    const job = await enqueueExport({
      kind: "patients",
      filters: {},
      requestedBy: "user-1",
      clinicId: "clinic-a",
      tenant: TENANT,
    });

    expect(job.status).toBe("pending");
    expect(getExport(job.id)).not.toBeNull();

    const ran = await __runExportForTests(job.id, TENANT);
    expect(ran).not.toBeNull();
    expect(ran!.status).toBe("done");
    expect(ran!.rowCount).toBe(1);
    expect(ran!.filePath).toMatch(/exports\/.+\.csv$/);
    expect(ran!.fileSize).toBeGreaterThan(0);
    expect(ran!.startedAt).not.toBeNull();
    expect(ran!.finishedAt).not.toBeNull();
  });

  it("writes a UTF-8 BOM + header row for patients CSV", async () => {
    patientRows.push({
      id: "p1",
      fullName: "Alice",
      phone: "+998",
      gender: "F",
      birthDate: null,
      segment: null,
      source: null,
      ltv: 0,
      visitsCount: 0,
      balance: 0,
      lastVisitAt: null,
      tags: [],
      createdAt: new Date("2026-04-01"),
    });

    const job = await enqueueExport({
      kind: "patients",
      filters: {},
      requestedBy: null,
      clinicId: "clinic-a",
      tenant: TENANT,
    });
    const ran = await __runExportForTests(job.id, TENANT);
    const body = await fs.readFile(ran!.filePath!, "utf8");

    // BOM is U+FEFF
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const withoutBom = body.slice(1);
    const lines = withoutBom.split("\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      "id,fullName,phone,gender,birthDate,segment,source,ltv,visitsCount,balance,lastVisitAt,tags,createdAt",
    );
    // Data row
    expect(lines[1]?.startsWith("p1,Alice,+998,F,,,,")).toBe(true);
  });

  it("RFC-4180 quotes commas, quotes, and newlines in field values", async () => {
    patientRows.push({
      id: "p1",
      fullName: 'Ali, "The" Great',
      phone: "line1\nline2",
      gender: "M",
      birthDate: null,
      segment: null,
      source: null,
      ltv: 0,
      visitsCount: 0,
      balance: 0,
      lastVisitAt: null,
      tags: [],
      createdAt: new Date("2026-04-01"),
    });

    const job = await enqueueExport({
      kind: "patients",
      filters: {},
      requestedBy: null,
      clinicId: "clinic-a",
      tenant: TENANT,
    });
    const ran = await __runExportForTests(job.id, TENANT);
    const body = await fs.readFile(ran!.filePath!, "utf8");

    // fullName must become `"Ali, ""The"" Great"`
    expect(body).toContain('"Ali, ""The"" Great"');
    // phone with newline must be wrapped in quotes
    expect(body).toContain('"line1\nline2"');
  });

  it("cursor-paginates across >PAGE rows for appointments", async () => {
    // PAGE = 500; push 501 rows so the loop hits a second page.
    for (let i = 0; i < 501; i += 1) {
      appointmentRows.push({
        id: `a${String(i).padStart(4, "0")}`,
        date: new Date("2026-04-20T00:00:00Z"),
        status: "SCHEDULED",
        doctorId: "d1",
        patientId: "p1",
        serviceId: "s1",
        channel: "WEB",
        priceFinal: 10000,
        createdAt: new Date("2026-04-01"),
      });
    }

    const job = await enqueueExport({
      kind: "appointments",
      filters: {},
      requestedBy: null,
      clinicId: "clinic-a",
      tenant: TENANT,
    });
    const ran = await __runExportForTests(job.id, TENANT);

    expect(ran!.status).toBe("done");
    expect(ran!.rowCount).toBe(501);

    const body = await fs.readFile(ran!.filePath!, "utf8");
    const dataLines = body.split("\n").filter((l) => l.length > 0);
    // header + 501 data rows
    expect(dataLines.length).toBe(502);
  });

  it("marks the job failed when the kind is unknown", async () => {
    const job = await enqueueExport({
      // @ts-expect-error -- deliberately invalid kind
      kind: "nonsense",
      filters: {},
      requestedBy: null,
      clinicId: "clinic-a",
      tenant: TENANT,
    });
    const ran = await __runExportForTests(job.id, TENANT);
    expect(ran!.status).toBe("failed");
    expect(ran!.error).toMatch(/unknown kind/i);
  });

  it("returns null when running an unknown jobId", async () => {
    const ran = await __runExportForTests("does-not-exist", TENANT);
    expect(ran).toBeNull();
  });

  it("emits payments CSV with the expected columns", async () => {
    paymentRows.push({
      id: "pay1",
      appointmentId: "a1",
      patientId: "p1",
      amount: 10000,
      currency: "UZS",
      method: "CASH",
      status: "PAID",
      paidAt: new Date("2026-04-21T10:00:00Z"),
      createdAt: new Date("2026-04-21T10:00:00Z"),
    });
    const job = await enqueueExport({
      kind: "payments",
      filters: { paidOnly: true },
      requestedBy: null,
      clinicId: "clinic-a",
      tenant: TENANT,
    });
    const ran = await __runExportForTests(job.id, TENANT);
    const body = await fs.readFile(ran!.filePath!, "utf8");
    const lines = body.slice(1).split("\n").filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      "id,appointmentId,patientId,amount,currency,method,status,paidAt,createdAt",
    );
    expect(ran!.rowCount).toBe(1);
  });
});
