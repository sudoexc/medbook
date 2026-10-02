/**
 * Audit G1-12 — a visit-note PATCH that changes nothing writes no AuditLog
 * row. The prescription constructor resends its unchanged list on every
 * interaction (collapsing a row, say), and each such autosave used to leave
 * a `visit_note.update` row with `fields: []`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  note: null as null | Record<string, unknown>,
  audits: [] as Array<{ action: string; meta?: { fields?: string[] } }>,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@example.test" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_doc_1", role: "DOCTOR" }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, input: (typeof h.audits)[number]) => {
    h.audits.push(input);
  }),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => {}),
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEphemeralEnvelope: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findUnique: vi.fn(async () => h.note),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.note = { ...h.note, ...data, updatedAt: new Date() };
        return { ...h.note, visitPrescriptions: [] };
      }),
    },
    visitPrescription: {
      // Nothing prescribed yet: an empty list resent is no change.
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_1", nameRu: "Доктор" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const { prisma } = await import("@/lib/prisma");
      return fn(prisma);
    }),
  },
}));

async function patch(body: unknown): Promise<Response> {
  const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/visit-notes/vn_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.audits = [];
  h.note = {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "DRAFT",
    finalizedAt: null,
    firstFinalizedAt: null,
    bodyMarkdown: "initial",
    patientHandoutMarkdown: null,
    updatedAt: new Date("2026-10-01T10:00:00Z"),
  };
});

describe("PATCH /api/crm/visit-notes/[id] audit", () => {
  it("writes no row for an autosave that changed nothing", async () => {
    const res = await patch({ visitPrescriptions: [] });
    expect(res.status).toBe(200);
    expect(h.audits).toEqual([]);
  });

  it("still writes one row naming the fields that changed", async () => {
    const res = await patch({ bodyMarkdown: "edited" });
    expect(res.status).toBe(200);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: "visit_note.update",
      meta: { fields: ["bodyMarkdown"] },
    });
  });
});
