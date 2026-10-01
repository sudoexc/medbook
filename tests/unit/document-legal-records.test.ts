/**
 * Documents as legal records and their origin (audits CD-09, CD-06, CD-05).
 *
 *   - CD-09: DELETE removed conclusions, referral PDFs and signed consents
 *     for ADMIN (the worker then minted a conclusion with a NEW QR token,
 *     so the printed one stopped verifying); «Заменить файл» kept «Подписано»
 *     on whatever was uploaded and deleted the original scan. Now both answer
 *     409, and edits/deletions reach the patient's Mini App.
 *   - CD-06: the origin is an explicit `source`; «ожидают подписи» and «Отметить
 *     подписанным» only ever concern the clinic's own consents.
 *   - CD-05: a consent captured on the signature pad is filed already signed,
 *     and the unsigned consent it belongs to is stamped with it.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canMarkSigned,
  documentDeleteLock,
  documentReplaceLock,
  isPatientDocument,
  isRenderedDocument,
} from "@/lib/document-guards";
import { signDocumentUpload } from "@/server/documents/file-ref";

beforeAll(() => {
  process.env.APP_SECRET = "test-app-secret";
});

type Doc = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  visitNoteId: string | null;
  referralId: string | null;
  type: string;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedById: string | null;
  source: string;
  signedAt: Date | null;
  createdAt: Date;
};

const OLD_URL = "https://minio.example/medbook/clinics/c1/documents/old-scan.pdf";
const NEW_KEY = "clinics/c1/documents/new-scan.pdf";
const NEW_URL = `https://minio.example/medbook/${NEW_KEY}`;

const h = vi.hoisted(() => ({
  user: { id: "u_admin", role: "ADMIN", clinicId: "c1", email: "a@x.test" },
  docs: new Map<string, Record<string, unknown>>(),
  deleted: [] as string[],
  deletedKeys: [] as string[],
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  updateMany: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  created: [] as Array<Record<string, unknown>>,
  published: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  audits: [] as string[],
  listWhere: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: h.user })) }));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: h.user.id,
    role: h.user.role as never,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(
    async (_tx: unknown, input: { type: string; payload: Record<string, unknown> }) => {
      h.published.push({ type: input.type, payload: input.payload });
      return {};
    },
  ),
}));
vi.mock("@/server/storage/minio", () => ({
  deleteObject: vi.fn(async (_b: unknown, key: string) => {
    h.deletedKeys.push(key);
  }),
}));

vi.mock("@/lib/prisma", () => {
  const document = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => h.docs.get(where.id) ?? null),
    // Two callers: storageKeyInUse (`where.OR` over fileUrl spellings) and
    // the signature's target consent (by id + patient + clinic).
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.OR) return null;
      const row = h.docs.get(where.id as string);
      if (!row || row.patientId !== where.patientId) return null;
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      h.updates.push({ id: where.id, data });
      const row = { ...h.docs.get(where.id)!, ...data };
      h.docs.set(where.id, row);
      return row;
    }),
    updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      h.updateMany.push(args);
      return { count: 1 };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      h.deleted.push(where.id);
      return h.docs.get(where.id);
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      h.created.push(data);
      return { id: "d_new", createdAt: new Date(), ...data };
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      h.listWhere = where;
      return [];
    }),
  };
  const prisma = {
    document,
    doctor: { findFirst: vi.fn(async () => null) },
    patient: { findFirst: vi.fn(async () => ({ id: "p1" })) },
    appointment: { findFirst: vi.fn(async () => ({ id: "a1" })) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string } }) => {
        h.audits.push(data.action);
        return { id: "al" };
      }),
    },
    $queryRawUnsafe: vi.fn(async () => []),
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),
  };
  return { prisma };
});

import { DELETE, PATCH } from "@/app/api/crm/documents/[id]/route";
import { POST as SIGN } from "@/app/api/crm/documents/[id]/sign/route";
import { GET as LIST, POST as CREATE } from "@/app/api/crm/documents/route";

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: "d1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: null,
    visitNoteId: null,
    referralId: null,
    type: "RESULT",
    title: "МРТ",
    fileUrl: OLD_URL,
    mimeType: "application/pdf",
    sizeBytes: 1000,
    uploadedById: "u_admin",
    source: "STAFF",
    signedAt: null,
    createdAt: new Date("2026-09-01T09:00:00Z"),
    ...overrides,
  };
}

function put(doc: Doc) {
  h.docs.set(doc.id, doc as unknown as Record<string, unknown>);
}

const del = (id = "d1") =>
  DELETE(new Request(`https://x/api/crm/documents/${id}`, { method: "DELETE" }));
const patch = (body: unknown, id = "d1") =>
  PATCH(
    new Request(`https://x/api/crm/documents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const sign = (id = "d1") =>
  SIGN(new Request(`https://x/api/crm/documents/${id}/sign`, { method: "POST" }));
const create = (body: unknown) =>
  CREATE(
    new Request("https://x/api/crm/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  h.user = { id: "u_admin", role: "ADMIN", clinicId: "c1", email: "a@x.test" };
  h.docs.clear();
  h.deleted = [];
  h.deletedKeys = [];
  h.updates = [];
  h.updateMany = [];
  h.created = [];
  h.published = [];
  h.audits = [];
  h.listWhere = null;
});

describe("document guards (pure)", () => {
  it("rendered documents and signed consents are locked; ordinary uploads are not", () => {
    expect(documentDeleteLock({ type: "CONCLUSION" })).toBe("rendered_document");
    expect(documentDeleteLock({ type: "REFERRAL", referralId: "r1" })).toBe("rendered_document");
    expect(documentDeleteLock({ type: "OTHER", visitNoteId: "vn1" })).toBe("rendered_document");
    // A conclusion whose note was deleted (SetNull) stays the system's.
    expect(isRenderedDocument({ type: "OTHER", source: "SYSTEM" })).toBe(true);
    expect(documentDeleteLock({ type: "CONSENT", signedAt: "2026-09-01" })).toBe("signed_document");
    expect(documentReplaceLock({ type: "CONTRACT", signedAt: new Date() })).toBe("signed_document");
    expect(documentDeleteLock({ type: "CONSENT", signedAt: null })).toBeNull();
    expect(documentDeleteLock({ type: "RESULT" })).toBeNull();
  });

  it("only the clinic's own unsigned consent or contract can be marked signed", () => {
    expect(canMarkSigned({ type: "CONSENT", source: "STAFF" })).toBe(true);
    expect(canMarkSigned({ type: "CONTRACT", source: "STAFF" })).toBe(true);
    expect(canMarkSigned({ type: "CONSENT", source: "PATIENT" })).toBe(false);
    expect(canMarkSigned({ type: "CONSENT", source: "STAFF", signedAt: new Date() })).toBe(false);
    expect(canMarkSigned({ type: "RESULT", source: "STAFF" })).toBe(false);
    expect(isPatientDocument({ source: "PATIENT" })).toBe(true);
    // The old proxy: a worker conclusion has no uploader, yet is not the patient's.
    expect(isPatientDocument({ source: "SYSTEM" })).toBe(false);
  });
});

describe("DELETE /api/crm/documents/[id] (CD-09)", () => {
  it("refuses a conclusion for ADMIN with 409 and deletes nothing", async () => {
    put(makeDoc({ type: "CONCLUSION", visitNoteId: "vn1", uploadedById: null, source: "SYSTEM" }));
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "rendered_document" });
    expect(h.deleted).toEqual([]);
    expect(h.deletedKeys).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it("refuses a referral PDF and a signed consent", async () => {
    put(makeDoc({ type: "REFERRAL", referralId: "r1", source: "SYSTEM" }));
    expect((await del()).status).toBe(409);

    put(makeDoc({ type: "CONSENT", signedAt: new Date("2026-09-02T10:00:00Z") }));
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "SignedDocumentLocked",
      reason: "signed_document",
    });
    expect(h.deleted).toEqual([]);
  });

  it("deletes an ordinary upload and tells the Mini App", async () => {
    put(makeDoc());
    const res = await del();
    expect(res.status).toBe(200);
    expect(h.deleted).toEqual(["d1"]);
    expect(h.published).toEqual([
      {
        type: "document.deleted",
        payload: { documentId: "d1", patientId: "p1", documentType: "RESULT" },
      },
    ]);
    expect(h.audits).toContain("document.delete");
  });
});

describe("PATCH /api/crm/documents/[id] (CD-09)", () => {
  it("a signed consent keeps its file: replacement is 409, the original stays", async () => {
    put(makeDoc({ type: "CONSENT", signedAt: new Date("2026-09-02T10:00:00Z") }));
    const res = await patch({
      fileUrl: NEW_URL,
      uploadToken: signDocumentUpload("c1", NEW_KEY),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "signed_document" });
    expect(h.updates).toEqual([]);
    expect(h.deletedKeys).toEqual([]);
  });

  it("a signed consent cannot be retyped (that would make it deletable)", async () => {
    put(makeDoc({ type: "CONSENT", signedAt: new Date() }));
    expect((await patch({ type: "OTHER" })).status).toBe(409);
    expect(h.updates).toEqual([]);
  });

  it("its title can still be corrected, and the change reaches the Mini App", async () => {
    put(makeDoc({ type: "CONSENT", signedAt: new Date() }));
    const res = await patch({ title: "Согласие на обработку данных" });
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.published.map((p) => p.type)).toEqual(["document.updated"]);
  });
});

describe("POST /api/crm/documents/[id]/sign (CD-06)", () => {
  it("a patient's upload labelled «Согласие» is not the clinic's consent", async () => {
    put(makeDoc({ type: "CONSENT", source: "PATIENT", uploadedById: null }));
    const res = await sign();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "not_signable" });
    expect(h.updates).toEqual([]);
  });

  it("the clinic's consent is stamped", async () => {
    put(makeDoc({ type: "CONSENT" }));
    const res = await sign();
    expect(res.status).toBe(200);
    expect(h.updates[0]?.data.signedAt).toBeInstanceOf(Date);
  });
});

describe("GET /api/crm/documents (CD-06)", () => {
  it("«ожидают подписи» lists only the clinic's own unsigned consents", async () => {
    const res = await LIST(new Request("https://x/api/crm/documents?pendingSignature=true"));
    expect(res.status).toBe(200);
    const and = (h.listWhere?.AND ?? []) as Array<Record<string, unknown>>;
    expect(and).toContainEqual({
      type: { in: ["CONSENT", "CONTRACT"] },
      signedAt: null,
      source: "STAFF",
      visitNoteId: null,
      referralId: null,
    });
  });

  it("filters by source", async () => {
    await LIST(new Request("https://x/api/crm/documents?source=PATIENT"));
    expect(h.listWhere?.source).toBe("PATIENT");
  });
});

describe("POST /api/crm/documents (CD-05, CD-06)", () => {
  const key = "clinics/c1/documents/abc-signature-2026-10-01.png";
  const url = `https://minio.example/medbook/${key}`;

  it("files a staff upload with source STAFF and no signature", async () => {
    const res = await create({
      patientId: "p1",
      type: "RESULT",
      title: "МРТ",
      fileUrl: url,
      uploadToken: signDocumentUpload("c1", key),
    });
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ source: "STAFF", signedAt: null });
  });

  it("a signature captured on the pad is a signed consent, and signs the consent it names", async () => {
    put(makeDoc({ id: "consent1", type: "CONSENT", title: "Согласие на лечение" }));
    const res = await create({
      patientId: "p1",
      type: "CONSENT",
      title: "Подпись: Согласие на лечение",
      fileUrl: url,
      uploadToken: signDocumentUpload("c1", key),
      mimeType: "image/png",
      sizeBytes: 48_000,
      signed: true,
      signsDocumentId: "consent1",
    });
    expect(res.status).toBe(201);
    expect(h.created[0]?.signedAt).toBeInstanceOf(Date);
    expect(h.updateMany).toEqual([
      {
        where: { id: "consent1", signedAt: null },
        data: { signedAt: h.created[0]?.signedAt },
      },
    ]);
    expect(h.audits).toEqual(expect.arrayContaining(["document.create", "document.sign"]));
  });

  it("refuses to sign a consent that is already signed or is the patient's own", async () => {
    put(makeDoc({ id: "consent1", type: "CONSENT", signedAt: new Date() }));
    let res = await create({
      patientId: "p1",
      type: "CONSENT",
      title: "Подпись",
      fileUrl: url,
      uploadToken: signDocumentUpload("c1", key),
      signed: true,
      signsDocumentId: "consent1",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "consent_not_signable" });

    put(makeDoc({ id: "consent1", type: "CONSENT", source: "PATIENT", uploadedById: null }));
    res = await create({
      patientId: "p1",
      type: "CONSENT",
      title: "Подпись",
      fileUrl: url,
      uploadToken: signDocumentUpload("c1", key),
      signsDocumentId: "consent1",
    });
    expect(res.status).toBe(400);
    expect(h.created).toEqual([]);
  });

  it("only a consent or contract is ever filed as signed", async () => {
    const res = await create({
      patientId: "p1",
      type: "RESULT",
      title: "МРТ",
      fileUrl: url,
      uploadToken: signDocumentUpload("c1", key),
      signed: true,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "signed_only_for_consent" });
  });
});
