/**
 * Audit G1-12 — a visit-note PATCH that changes nothing writes no AuditLog
 * row. The prescription constructor resends its unchanged list on every
 * interaction (collapsing a row, say), and each such autosave used to leave
 * a `visit_note.update` row with `fields: []`.
 *
 * And a never-signed draft writes one row per editing session, not one per
 * autosave: the editor PATCHes one field every 1.5 s, so a visit with fifty
 * autosaves left fifty rows. Signed notes keep a row per correction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  note: null as null | Record<string, unknown>,
  audits: [] as Array<{
    action: string;
    entityId?: string | null;
    at?: number;
    meta?: { fields?: string[]; revisions?: unknown };
  }>,
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
    h.audits.push({ ...input, at: Date.now() });
  }),
}));
// A signed note's correction records revisions in the same transaction;
// those have their own tests (visit-note-signed-versions).
vi.mock("@/server/visit-notes/revisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/visit-notes/revisions")>()),
  recordSignedEdit: vi.fn(async () => ({ before: 1, after: 2 })),
  ensureSignedStateOnRecord: vi.fn(async () => {}),
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
    // The rows `audit()` wrote above (all by u_doc_1, the session user).
    auditLog: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { action: string; entityId: string; createdAt: { gte: Date } };
        }) =>
          h.audits.find(
            (a) =>
              a.action === where.action &&
              a.entityId === where.entityId &&
              (a.at ?? 0) >= where.createdAt.gte.getTime(),
          ) ?? null,
      ),
    },
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
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

afterEach(() => {
  vi.useRealTimers();
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

  it("a draft's fifty autosaves in one sitting write one row", async () => {
    for (let i = 0; i < 50; i += 1) {
      // One field per save, every ~30 s: a 25-minute visit.
      vi.setSystemTime(new Date(Date.parse("2026-10-01T10:00:00Z") + i * 30_000));
      const res = await patch({ bodyMarkdown: `edit ${i}` });
      expect(res.status).toBe(200);
    }
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: "visit_note.update",
      entityId: "vn_1",
      meta: { fields: ["bodyMarkdown"] },
    });
  });

  it("a draft edited again after a long pause gets a new row", async () => {
    await patch({ bodyMarkdown: "morning" });
    vi.setSystemTime(new Date("2026-10-01T10:20:00Z"));
    await patch({ bodyMarkdown: "still the same sitting" });
    expect(h.audits).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-01T11:00:00Z"));
    await patch({ patientHandoutMarkdown: "back after lunch" });
    expect(h.audits).toHaveLength(2);
    expect(h.audits[1]?.meta?.fields).toEqual(["patientHandoutMarkdown"]);
  });

  it("every correction of a signed note keeps its own row", async () => {
    h.note = {
      ...h.note,
      status: "FINALIZED",
      finalizedAt: new Date("2026-10-01T09:00:00Z"),
      firstFinalizedAt: new Date("2026-10-01T09:00:00Z"),
    };
    for (let i = 0; i < 3; i += 1) {
      vi.setSystemTime(new Date(Date.parse("2026-10-01T10:00:00Z") + i * 30_000));
      const res = await patch({ bodyMarkdown: `corrected ${i}` });
      expect(res.status).toBe(200);
    }
    expect(h.audits).toHaveLength(3);
    for (const a of h.audits) {
      expect(a.meta?.revisions).toEqual({ before: 1, after: 2 });
    }
  });

  it("a reopened note (signed once, reverted) is not coalesced either", async () => {
    h.note = {
      ...h.note,
      status: "DRAFT",
      finalizedAt: null,
      firstFinalizedAt: new Date("2026-10-01T09:00:00Z"),
    };
    await patch({ bodyMarkdown: "one" });
    await patch({ bodyMarkdown: "two" });
    expect(h.audits).toHaveLength(2);
  });
});

describe("draftEditAuditedRecently", () => {
  it("never coalesces without an actor, and writes the row when the lookup fails", async () => {
    const { draftEditAuditedRecently } = await import("@/server/visit-notes/draft-audit");
    const findFirst = vi.fn(async () => ({ id: "a1" }));
    const db = { auditLog: { findFirst } } as never;
    expect(await draftEditAuditedRecently(db, { visitNoteId: "vn_1", actorId: null })).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
    expect(await draftEditAuditedRecently(db, { visitNoteId: "vn_1", actorId: "u1" })).toBe(true);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      auditLog: {
        findFirst: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
    } as never;
    expect(await draftEditAuditedRecently(broken, { visitNoteId: "vn_1", actorId: "u1" })).toBe(
      false,
    );
    errSpy.mockRestore();
  });
});
