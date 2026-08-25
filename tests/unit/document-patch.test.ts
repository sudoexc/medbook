/**
 * PATCH /api/crm/documents/[id] — edit uploaded documents (rename, retype,
 * replace file).
 *
 * Covered here:
 *   - ownership: DOCTOR may only edit their own uploads (403 otherwise),
 *     ADMIN may edit anyone's;
 *   - rendered-document guard: CONCLUSION type or visitNoteId/referralId set
 *     → 409, the row must be edited through its source entity;
 *   - schema: CONCLUSION can never be assigned via `type`, empty patch → 400;
 *   - happy path: rename persists and emits a `document.update` audit row
 *     with before/after snapshots of the changed fields;
 *   - file replacement: old storage blob is deleted after the DB update.
 *
 * Strategy mirrors appointment-reschedule-audit.test.ts: mock every
 * collaborator the route imports and capture prisma/audit/storage calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

type Doc = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  visitNoteId: string | null;
  referralId: string | null;
  type: string;
  title: string;
  number: string | null;
  verifyToken: string | null;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string | null;
  signedAt: Date | null;
  createdAt: Date;
};

type SessionUser = {
  id: string;
  role: string;
  clinicId: string | null;
  email: string;
};

const OLD_FILE_URL =
  "https://minio.example/medbook/clinics/c1/documents/old-key-scan.pdf";
const NEW_FILE_URL =
  "https://minio.example/medbook/clinics/c1/documents/new-key-scan.pdf";

const state = {
  doc: null as Doc | null,
  user: null as SessionUser | null,
  audits: [] as Array<{ action: string; entityId: string | null; meta: unknown }>,
  deletedKeys: [] as string[],
  updateCalls: 0,
};

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: "d1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: null,
    visitNoteId: null,
    referralId: null,
    type: "RESULT",
    title: "МРТ головного мозга",
    number: null,
    verifyToken: null,
    fileUrl: OLD_FILE_URL,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    uploadedById: "u_doc_1",
    signedAt: null,
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
    ...overrides,
  };
}

const DOCTOR: SessionUser = {
  id: "u_doc_1",
  role: "DOCTOR",
  clinicId: "c1",
  email: "doc@example.test",
};
const OTHER_DOCTOR: SessionUser = {
  id: "u_doc_2",
  role: "DOCTOR",
  clinicId: "c1",
  email: "doc2@example.test",
};
const ADMIN: SessionUser = {
  id: "u_admin",
  role: "ADMIN",
  clinicId: "c1",
  email: "admin@example.test",
};

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (state.user ? { user: state.user } : null)),
}));

vi.mock("@/lib/pin", () => ({
  hasValidPin: () => false,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: state.user?.id ?? "u_doc_1",
    role: (state.user?.role ?? "DOCTOR") as never,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/server/storage/minio", () => ({
  deleteObject: vi.fn(async (_bucket: unknown, key: string) => {
    state.deletedKeys.push(key);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.doc && state.doc.id === where.id) return state.doc;
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
          if (!state.doc || state.doc.id !== where.id) {
            throw new Error("not found");
          }
          state.updateCalls += 1;
          state.doc = { ...state.doc, ...(data as Partial<Doc>) };
          return state.doc;
        },
      ),
      delete: vi.fn(async () => {
        throw new Error("delete should not be called by PATCH");
      }),
    },
    auditLog: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { action: string; entityId: string | null; meta: unknown };
        }) => {
          state.audits.push({
            action: data.action,
            entityId: data.entityId ?? null,
            meta: data.meta,
          });
          return { id: `a_${state.audits.length}` };
        },
      ),
    },
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadPatch() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/documents/[id]/route");
  return mod.PATCH;
}

function patchReq(body: unknown): Request {
  return new Request("https://x/api/crm/documents/d1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.doc = makeDoc();
  state.user = DOCTOR;
  state.audits = [];
  state.deletedKeys = [];
  state.updateCalls = 0;
});

// ----- tests ---------------------------------------------------------------

describe("PATCH /api/crm/documents/[id]", () => {
  it("renames own document and writes a document.update audit with before/after", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ title: "МРТ (исправлено)" }));
    expect(res.status).toBe(200);
    expect(state.doc?.title).toBe("МРТ (исправлено)");

    const auditRow = state.audits.find((a) => a.action === "document.update");
    expect(auditRow).toBeDefined();
    expect(auditRow!.entityId).toBe("d1");
    const meta = auditRow!.meta as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    // Snapshot of changed fields only — the "before" value must be traceable.
    expect(meta.before.title).toBe("МРТ головного мозга");
    expect(meta.after.title).toBe("МРТ (исправлено)");
  });

  it("changes document type for own upload", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ type: "REFERRAL" }));
    expect(res.status).toBe(200);
    expect(state.doc?.type).toBe("REFERRAL");
  });

  it("rejects a DOCTOR editing someone else's upload with 403 and no write", async () => {
    state.user = OTHER_DOCTOR; // doc.uploadedById stays u_doc_1
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ title: "hijack" }));
    expect(res.status).toBe(403);
    expect(state.updateCalls).toBe(0);
    expect(state.doc?.title).toBe("МРТ головного мозга");
    expect(state.audits).toHaveLength(0);
  });

  it("allows ADMIN to edit another user's upload", async () => {
    state.user = ADMIN;
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ title: "Переименовано админом" }));
    expect(res.status).toBe(200);
    expect(state.doc?.title).toBe("Переименовано админом");
  });

  it("rejects PATCH on a CONCLUSION document with 409", async () => {
    state.doc = makeDoc({ type: "CONCLUSION", uploadedById: "u_doc_1" });
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ title: "nope" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ReadOnlyRenderedDocument");
    expect(state.updateCalls).toBe(0);
  });

  it("rejects PATCH on worker-rendered rows (visitNoteId / referralId set)", async () => {
    const PATCH = await loadPatch();

    state.doc = makeDoc({ visitNoteId: "vn1" });
    let res = await PATCH(patchReq({ title: "nope" }));
    expect(res.status).toBe(409);

    state.doc = makeDoc({ referralId: "ref1" });
    res = await PATCH(patchReq({ title: "nope" }));
    expect(res.status).toBe(409);
    expect(state.updateCalls).toBe(0);
  });

  it("schema refuses converting a document INTO a conclusion", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ type: "CONCLUSION" }));
    expect(res.status).toBe(400); // zod: CONCLUSION is not in DocumentTypeEnum
    expect(state.updateCalls).toBe(0);
  });

  it("rejects an empty patch body", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({}));
    expect(res.status).toBe(400);
    expect(state.updateCalls).toBe(0);
  });

  it("replaces the file and deletes the old storage blob", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({
        fileUrl: NEW_FILE_URL,
        mimeType: "image/png",
        sizeBytes: 2048,
      }),
    );
    expect(res.status).toBe(200);
    expect(state.doc?.fileUrl).toBe(NEW_FILE_URL);
    expect(state.doc?.mimeType).toBe("image/png");
    expect(state.doc?.sizeBytes).toBe(2048);
    // Old blob cleaned up, new blob untouched.
    expect(state.deletedKeys).toEqual(["clinics/c1/documents/old-key-scan.pdf"]);

    const auditRow = state.audits.find((a) => a.action === "document.update");
    expect(auditRow).toBeDefined();
    const meta = auditRow!.meta as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };
    expect(meta.before.fileUrl).toBe(OLD_FILE_URL);
    expect(meta.after.fileUrl).toBe(NEW_FILE_URL);
  });

  it("does not touch storage when fileUrl is unchanged", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(
      patchReq({ title: "Новое имя", fileUrl: OLD_FILE_URL }),
    );
    expect(res.status).toBe(200);
    expect(state.deletedKeys).toHaveLength(0);
  });

  it("returns 404 for a missing document", async () => {
    state.doc = null;
    const PATCH = await loadPatch();
    const res = await PATCH(patchReq({ title: "x" }));
    expect(res.status).toBe(404);
  });
});
