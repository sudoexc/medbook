/**
 * P6 lane B3, server side of the low-severity CRM items:
 *
 *   - CD-10: one AuditLog row per sick-leave / e-prescription event. The
 *     routes call audit() themselves, so the outbox pumper must not write a
 *     second row from the event.
 *   - CD-14: the per-patient `#N` count matches on clinicId, the leading
 *     column of the only usable index.
 *   - CD-15: a DOCTOR user without a Doctor profile gets an empty documents
 *     list, not every document of the clinic.
 *   - CD-17: `?type=CONCLUSION` filters (it answered 400), while a
 *     conclusion still cannot be filed by hand.
 *   - CM-22: «Записей сегодня» leaves out cancelled visits and no-shows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "DOCTOR" as string,
  doctor: { id: "doc_1" } as { id: string } | null,
  docWhere: null as Record<string, unknown> | null,
  docRows: [] as Array<Record<string, unknown>>,
  rawSql: [] as string[],
  countWhere: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: "u1", role: h.role });
  return {
    createApiHandler:
      (_o: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, body: undefined, ctx: ctx() }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx: ctx() }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/storage-ref", () => ({ withStaffFileUrl: (r: unknown) => r }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.docWhere = where;
        return h.docRows;
      }),
    },
    doctor: { findFirst: vi.fn(async () => h.doctor) },
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      h.rawSql.push(sql);
      return [];
    }),
    appointment: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.countWhere = where;
        return 7;
      }),
      aggregate: vi.fn(async () => ({ _sum: { durationMin: 0 } })),
    },
    doctorSchedule: { findMany: vi.fn(async () => []) },
    doctorTimeOff: { findMany: vi.fn(async () => []) },
    call: { count: vi.fn(async () => 0) },
    conversation: { count: vi.fn(async () => 0) },
    notificationSend: { count: vi.fn(async () => 0) },
    lead: { count: vi.fn(async () => 0) },
  },
}));

import { prisma } from "@/lib/prisma";
import { getEventMeta } from "@/server/realtime/envelope";
import {
  CreateDocumentSchema,
  QueryDocumentSchema,
} from "@/server/schemas/document";
import { GET as documentsGet } from "@/app/api/crm/documents/route";
import { GET as shellSummaryGet } from "@/app/api/crm/shell-summary/route";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

beforeEach(() => {
  h.role = "DOCTOR";
  h.doctor = { id: "doc_1" };
  h.docWhere = null;
  h.docRows = [];
  h.rawSql = [];
  h.countWhere = null;
  vi.mocked(prisma.document.findMany).mockClear();
});

describe("CD-10: sick leave and e-prescription events have one audit source", () => {
  it.each([
    "eprescription.issued",
    "eprescription.cancelled",
    "sickleave.issued",
    "sickleave.cancelled",
  ] as const)("%s is not materialised by the outbox pumper", (type) => {
    expect(getEventMeta(type).auditable).toBe(false);
  });

  it("the cancel routes keep their own audit() call, the one row left", () => {
    expect(src("src/app/api/crm/sick-leaves/[id]/route.ts")).toContain(
      "action: AUDIT_ACTION.SICK_LEAVE_CANCELLED",
    );
    expect(src("src/app/api/crm/e-prescriptions/[id]/route.ts")).toContain(
      "action: AUDIT_ACTION.EPRESCRIPTION_CANCELLED",
    );
  });
});

describe("GET /api/crm/documents", () => {
  const get = (qs = "") =>
    documentsGet(new Request(`https://x/api/crm/documents${qs}`));

  it("CD-15: a DOCTOR with no Doctor profile gets an empty list, no query", async () => {
    h.doctor = null;
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [], nextCursor: null });
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it("CD-15: a doctor with a profile is still limited to their patients", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(JSON.stringify(h.docWhere)).toContain('"doctorId":"doc_1"');
  });

  it("CD-15: other roles never look up a Doctor row and see the clinic list", async () => {
    h.role = "RECEPTIONIST";
    h.doctor = null;
    const res = await get();
    expect(res.status).toBe(200);
    expect(prisma.document.findMany).toHaveBeenCalledTimes(1);
    expect(h.docWhere).not.toHaveProperty("AND");
  });

  it("CD-14: the #N count is scoped by clinic, the index's leading column", async () => {
    h.role = "ADMIN";
    h.docRows = [{ id: "d1", patientId: "p1", createdAt: new Date() }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(h.rawSql).toHaveLength(1);
    expect(h.rawSql[0].replace(/\s+/g, " ")).toContain(
      'd2."clinicId" = d."clinicId" AND d2."patientId" = d."patientId"',
    );
  });

  it("CD-17: ?type=CONCLUSION filters conclusions instead of answering 400", async () => {
    h.role = "RECEPTIONIST";
    const res = await get("?type=CONCLUSION");
    expect(res.status).toBe(200);
    expect(h.docWhere).toMatchObject({ type: "CONCLUSION" });
  });

  it("CD-17: an unknown type is still a 400", async () => {
    h.role = "RECEPTIONIST";
    const res = await get("?type=INVOICE");
    expect(res.status).toBe(400);
  });
});

describe("CD-17: conclusions are a filter, never a type to file", () => {
  it("the list query accepts every stored type, CONCLUSION included", () => {
    expect(QueryDocumentSchema.safeParse({ type: "CONCLUSION" }).success).toBe(true);
    expect(QueryDocumentSchema.safeParse({ type: "REFERRAL" }).success).toBe(true);
  });

  it("creating a document as CONCLUSION is still refused", () => {
    const r = CreateDocumentSchema.safeParse({
      patientId: "p1",
      type: "CONCLUSION",
      title: "x",
      fileUrl: "https://example.org/x.pdf",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "type")).toBe(true);
    }
  });
});

describe("CM-22: «Записей сегодня» counts the visits that still stand", () => {
  it("cancelled visits and no-shows are left out, the day bounds stay", async () => {
    h.role = "RECEPTIONIST";
    const res = await (shellSummaryGet as (r: Request) => Promise<Response>)(
      new Request("https://x/api/crm/shell-summary"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { today: { appointmentsCount: number } };
    expect(body.today.appointmentsCount).toBe(7);
    expect(h.countWhere).toMatchObject({
      date: { gte: expect.any(Date), lt: expect.any(Date) },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    });
  });
});
