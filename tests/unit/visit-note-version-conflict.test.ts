/**
 * Optimistic locking on PATCH /api/crm/visit-notes/[id].
 *
 * The same visit note can be open on the reception screen and in
 * /doctor/conclusions/[id] at once. The PATCH route therefore accepts an
 * optional `expectedUpdatedAt` token — the `updatedAt` of the revision the
 * client was editing — and must:
 *
 *   - accept an ordinary same-window sequence of edits, where each PATCH
 *     carries the `updatedAt` returned by the previous one;
 *   - reject a write whose token is stale (another window saved first) with
 *     409 `version_conflict` WITHOUT touching the row, so a doctor's text is
 *     never silently overwritten;
 *   - keep accepting token-less PATCHes (legacy callers, last-write-wins).
 *
 * Strategy: mock every collaborator the route imports and drive the real
 * handler with fetch Requests, mimicking the Prisma `@updatedAt` bump in the
 * in-memory update mock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

type VisitNote = {
  id: string;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  status: string;
  finalizedAt: Date | null;
  bodyMarkdown: string | null;
  patientHandoutMarkdown: string | null;
  updatedAt: Date;
};

const T0 = new Date("2026-08-20T10:00:00.000Z");

const state = {
  note: null as VisitNote | null,
  updateCalls: 0,
  publishes: 0,
  audits: 0,
};

function makeNote(overrides: Partial<VisitNote> = {}): VisitNote {
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "DRAFT",
    finalizedAt: null,
    bodyMarkdown: "initial",
    patientHandoutMarkdown: null,
    updatedAt: T0,
    ...overrides,
  };
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "u_doc_1",
      role: "DOCTOR",
      clinicId: "c1",
      email: "doctor@example.test",
    },
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

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => {
    state.audits += 1;
  }),
}));

vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => {
    state.publishes += 1;
  }),
}));

// Prisma mock — only the surface this PATCH actually touches. `update`
// mimics the real `@updatedAt` behaviour: every accepted write moves
// `updatedAt` strictly forward, which is what the lock compares against.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.note && state.note.id === where.id) return state.note;
        return null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          if (!state.note || state.note.id !== where.id) {
            throw new Error("not found");
          }
          state.updateCalls += 1;
          state.note = {
            ...state.note,
            ...(data as Partial<VisitNote>),
            updatedAt: new Date(state.note.updatedAt.getTime() + 1_000),
          };
          return { ...state.note, visitPrescriptions: [] };
        },
      ),
    },
    visitPrescription: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1" })),
    },
    $transaction: vi.fn(
      async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    ),
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadPatch() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/visit-notes/[id]/route");
  return mod.PATCH;
}

function patchReq(body: unknown): Request {
  return new Request("https://x/api/crm/visit-notes/vn_1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.note = makeNote();
  state.updateCalls = 0;
  state.publishes = 0;
  state.audits = 0;
});

// ----- tests ---------------------------------------------------------------

describe("PATCH /api/crm/visit-notes/[id] — optimistic locking", () => {
  it("accepts a matching expectedUpdatedAt and returns the bumped updatedAt", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ bodyMarkdown: "v1", expectedUpdatedAt: T0.toISOString() }),
    );
    expect(res.status).toBe(200);
    const row = (await res.json()) as { bodyMarkdown: string; updatedAt: string };
    expect(row.bodyMarkdown).toBe("v1");
    // The response must carry the NEW version so the client can chain on it.
    expect(new Date(row.updatedAt).getTime()).toBeGreaterThan(T0.getTime());
    expect(state.note?.bodyMarkdown).toBe("v1");
  });

  it("passes an ordinary same-window sequence: each PATCH chains on the returned updatedAt", async () => {
    const PATCH = await loadPatch();
    // This is exactly what the client's serialised autosave queue does: send,
    // fold the response's updatedAt into the cache, use it as the next token.
    let token = T0.toISOString();
    for (const text of ["v1", "v2", "v3"]) {
      const res = await PATCH(
        patchReq({ bodyMarkdown: text, expectedUpdatedAt: token }),
      );
      expect(res.status, `saving "${text}"`).toBe(200);
      token = ((await res.json()) as { updatedAt: string }).updatedAt;
    }
    expect(state.note?.bodyMarkdown).toBe("v3");
    expect(state.updateCalls).toBe(3);
  });

  it("rejects a stale token with 409 version_conflict and does not write", async () => {
    const PATCH = await loadPatch();
    const staleToken = T0.toISOString();
    // Another window saved in the meantime — the stored row moved forward.
    state.note = makeNote({
      bodyMarkdown: "other window's text",
      updatedAt: new Date(T0.getTime() + 60_000),
    });

    const res = await PATCH(
      patchReq({ bodyMarkdown: "stale draft", expectedUpdatedAt: staleToken }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      reason: string;
      currentUpdatedAt: string;
    };
    expect(body.error).toBe("conflict");
    expect(body.reason).toBe("version_conflict");
    expect(body.currentUpdatedAt).toBe(
      new Date(T0.getTime() + 60_000).toISOString(),
    );

    // The clinical invariant: a conflicting write must leave the row, the
    // outbox and the audit log completely untouched.
    expect(state.note?.bodyMarkdown).toBe("other window's text");
    expect(state.updateCalls).toBe(0);
    expect(state.publishes).toBe(0);
    expect(state.audits).toBe(0);
  });

  it("a stale second window stays rejected even after the first window keeps editing", async () => {
    const PATCH = await loadPatch();
    // Window A saves twice, chaining tokens.
    const res1 = await PATCH(
      patchReq({ bodyMarkdown: "A1", expectedUpdatedAt: T0.toISOString() }),
    );
    const tokenA = ((await res1.json()) as { updatedAt: string }).updatedAt;
    const res2 = await PATCH(
      patchReq({ bodyMarkdown: "A2", expectedUpdatedAt: tokenA }),
    );
    expect(res2.status).toBe(200);

    // Window B still holds the original token from before A's edits.
    const resB = await PATCH(
      patchReq({ bodyMarkdown: "B overwrite", expectedUpdatedAt: T0.toISOString() }),
    );
    expect(resB.status).toBe(409);
    expect(state.note?.bodyMarkdown).toBe("A2");
  });

  it("keeps accepting token-less PATCHes (legacy last-write-wins callers)", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ bodyMarkdown: "no token" }));
    expect(res.status).toBe(200);
    expect(state.note?.bodyMarkdown).toBe("no token");
  });

  it("treats an explicit null token as absent", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ bodyMarkdown: "null token", expectedUpdatedAt: null }),
    );
    expect(res.status).toBe(200);
    expect(state.note?.bodyMarkdown).toBe("null token");
  });

  it("rejects a malformed token with 400 before it can reach the comparison", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ bodyMarkdown: "x", expectedUpdatedAt: "not-a-date" }),
    );
    expect(res.status).toBe(400);
    expect(state.updateCalls).toBe(0);
  });
});
