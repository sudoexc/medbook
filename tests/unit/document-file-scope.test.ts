/**
 * Audit CD-08: the server trusted `fileUrl` from the request body.
 *
 * Staff could put a colleague's (or another clinic's) stored file on a new
 * document, then delete «their» document and take the original's file with
 * it, or press «send to Telegram» and deliver someone else's medical file;
 * send-telegram also read any bucket named in the URL.
 *
 * Pinned here:
 *   - a stored object is accepted only with the receipt the upload route
 *     issued for it, in this clinic's documents folder; anything else must
 *     be an https link (or the signature pad's inline PNG);
 *   - the document's patient and appointment belong together and to the clinic;
 *   - DELETE never removes another clinic's object, nor one another
 *     document still uses;
 *   - send-telegram reads only `clinics/<own id>/` in the main bucket;
 *   - staff pages never navigate to a `javascript:` or plain-http value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Receipts are HMACs over the app secret; some are signed at collection time.
vi.hoisted(() => {
  process.env.APP_SECRET = "test-app-secret";
});

const h = vi.hoisted(() => ({
  user: { id: "u_doc", role: "DOCTOR", clinicId: "c1", email: "d@x.t" },
  patient: { id: "p1" } as { id: string } | null,
  appointment: { id: "a1" } as { id: string } | null,
  appointmentWhere: null as unknown,
  keyInUseBy: null as string | null,
  doc: null as Record<string, unknown> | null,
  created: [] as unknown[],
  deletedKeys: [] as string[],
  fetched: [] as Array<{ bucket: unknown; key: string }>,
  sentFiles: [] as string[],
  documentsOfVisit: [] as Array<{ id: string; title: string; fileUrl: string; mimeType: string | null }>,
  packPhoto: null as string | null,
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
  publishViaOutbox: vi.fn(async () => ({})),
}));
vi.mock("@/server/storage/minio", () => ({
  deleteObject: vi.fn(async (_bucket: unknown, key: string) => {
    h.deletedKeys.push(key);
  }),
  fetchObject: vi.fn(async (bucket: unknown, key: string) => {
    h.fetched.push({ bucket, key });
    return { body: new Blob(["%PDF"]).stream(), contentType: "application/pdf" };
  }),
}));
vi.mock("@/server/telegram/send", () => ({
  sendDocument: vi.fn(async (_c: unknown, _chat: string, _b: unknown, o: { filename: string }) => {
    h.sentFiles.push(o.filename);
    return {};
  }),
}));

type OrWhere = { OR?: Array<{ fileUrl?: { contains: string } }> };

vi.mock("@/lib/prisma", () => {
  const document = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      h.created.push(data);
      return { id: "d_new", ...data };
    }),
    findUnique: vi.fn(async () => h.doc),
    delete: vi.fn(async () => h.doc),
    findFirst: vi.fn(async ({ where }: { where: OrWhere }) => {
      const key = h.keyInUseBy;
      if (!key || !where.OR) return null;
      return where.OR.some((c) => c.fileUrl?.contains === key) ? { id: "d_other" } : null;
    }),
    findMany: vi.fn(async () => h.documentsOfVisit),
  };
  return {
    prisma: {
      document,
      doctor: {
        // Two questions: «who is this doctor» (send-telegram's own-visit
        // check) and «does a signature use this key» (storageKeyInUse).
        findFirst: vi.fn(async ({ where }: { where: { OR?: unknown } }) =>
          where.OR ? null : { id: "doc_1" },
        ),
      },
      patient: { findFirst: vi.fn(async () => h.patient) },
      appointment: {
        findFirst: vi.fn(async (args: { where: unknown }) => {
          h.appointmentWhere = args.where;
          return h.appointment;
        }),
      },
      visitNote: {
        findUnique: vi.fn(async () => ({
          id: "vn1",
          doctorId: "doc_1",
          appointmentId: "a1",
          patient: { id: "p1", fullName: "Иванов Иван", telegramId: "777" },
          clinic: { id: "c1", slug: "neurofax", tgBotToken: "T", tgBotUsername: "bot" },
          visitPrescriptions: h.packPhoto
            ? [{ displayName: "Мидокалм", drug: { photoUrl: h.packPhoto } }]
            : [],
        })),
      },
      auditLog: { create: vi.fn(async () => ({ id: "al" })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ document })),
    },
  };
});

import {
  checkDocumentFileUrl,
  clinicReadableKey,
  signDocumentUpload,
  UPLOAD_TOKEN_TTL_MS,
} from "@/server/documents/file-ref";
import { documentHref } from "@/lib/storage-ref";
import { POST as createDocument } from "@/app/api/crm/documents/route";
import { DELETE as deleteDocument } from "@/app/api/crm/documents/[id]/route";
import { POST as sendTelegram } from "@/app/api/crm/visit-notes/[id]/send-telegram/route";

const OWN_KEY = "clinics/c1/documents/0b1c-mri.pdf";
const OWN_URL = `https://neurofax.uz/files/medbook/${OWN_KEY}`;

beforeEach(() => {
  h.user = { id: "u_doc", role: "DOCTOR", clinicId: "c1", email: "d@x.t" };
  h.patient = { id: "p1" };
  h.appointment = { id: "a1" };
  h.appointmentWhere = null;
  h.keyInUseBy = null;
  h.doc = null;
  h.created = [];
  h.deletedKeys = [];
  h.fetched = [];
  h.sentFiles = [];
  h.documentsOfVisit = [];
  h.packPhoto = null;
});

describe("checkDocumentFileUrl", () => {
  const now = Date.now();
  const receipt = signDocumentUpload("c1", OWN_KEY, now);

  it("accepts our stored object only with its receipt, in any URL shape", () => {
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: OWN_URL, uploadToken: receipt })).toEqual({
      ok: true,
      key: OWN_KEY,
    });
    const proxy = `/api/crm/documents/file?key=${encodeURIComponent(OWN_KEY)}`;
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: proxy, uploadToken: receipt }).ok).toBe(true);
  });

  it("refuses a stored object without a matching, fresh receipt", () => {
    const refused = { ok: false, reason: "file_not_issued" };
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: OWN_URL })).toEqual(refused);
    expect(
      checkDocumentFileUrl({
        clinicId: "c1",
        fileUrl: OWN_URL,
        uploadToken: signDocumentUpload("c1", "clinics/c1/documents/other.pdf", now),
      }),
    ).toEqual(refused);
    expect(
      checkDocumentFileUrl({
        clinicId: "c1",
        fileUrl: OWN_URL,
        uploadToken: receipt,
        now: now + UPLOAD_TOKEN_TTL_MS + 1,
      }),
    ).toEqual(refused);
    // Another clinic's receipt for the same key does not carry over.
    expect(
      checkDocumentFileUrl({
        clinicId: "c1",
        fileUrl: OWN_URL,
        uploadToken: signDocumentUpload("c2", OWN_KEY, now),
      }),
    ).toEqual(refused);
  });

  it("refuses another clinic's object and this clinic's rendered conclusions", () => {
    for (const key of [
      "clinics/c2/documents/their.pdf",
      "clinics/c1/conclusions/vn1/r0.pdf",
    ]) {
      expect(
        checkDocumentFileUrl({
          clinicId: "c1",
          fileUrl: `https://neurofax.uz/files/medbook/${key}`,
          uploadToken: signDocumentUpload("c1", key, now),
        }),
      ).toEqual({ ok: false, reason: "file_not_issued" });
    }
  });

  it("an external link must be https; the signature pad's PNG is allowed inline", () => {
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: "https://lab.example/r/1.pdf" })).toEqual({
      ok: true,
      key: null,
    });
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: "http://lab.example/r/1.pdf" }).ok).toBe(false);
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(checkDocumentFileUrl({ clinicId: "c1", fileUrl: "data:text/html,<script>" }).ok).toBe(false);
    expect(
      checkDocumentFileUrl({ clinicId: "c1", fileUrl: "data:image/png;base64,iVBORw0KGgo=" }).ok,
    ).toBe(true);
  });
});

describe("POST /api/crm/documents", () => {
  function post(body: Record<string, unknown>) {
    return createDocument(
      new Request("https://neurofax.uz/api/crm/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId: "p1", type: "RESULT", title: "МРТ", ...body }),
      }),
    );
  }

  it("a fileUrl the upload route did not issue is a 400", async () => {
    const res = await post({ fileUrl: OWN_URL });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "file_not_issued" });
    expect(h.created).toHaveLength(0);
  });

  it("the upload's receipt makes it a document", async () => {
    const res = await post({ fileUrl: OWN_URL, uploadToken: signDocumentUpload("c1", OWN_KEY) });
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ fileUrl: OWN_URL, patientId: "p1" });
    expect(h.created[0]).not.toHaveProperty("uploadToken");
  });

  it("an object another document already uses is refused, receipt or not", async () => {
    h.keyInUseBy = OWN_KEY;
    const res = await post({ fileUrl: OWN_URL, uploadToken: signDocumentUpload("c1", OWN_KEY) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "file_in_use" });
  });

  it("an appointment of another patient is a 400", async () => {
    h.appointment = null;
    const res = await post({
      fileUrl: "https://lab.example/r/1.pdf",
      appointmentId: "a_someone_else",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "appointment_patient_mismatch" });
    expect(h.appointmentWhere).toMatchObject({
      id: "a_someone_else",
      patientId: "p1",
      clinicId: "c1",
    });
    expect(h.created).toHaveLength(0);
  });

  it("a patient outside the clinic is a 400", async () => {
    h.patient = null;
    const res = await post({ fileUrl: "https://lab.example/r/1.pdf" });
    expect(res.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });
});

describe("DELETE /api/crm/documents/[id]", () => {
  function del() {
    return deleteDocument(
      new Request("https://neurofax.uz/api/crm/documents/d1", { method: "DELETE" }),
    );
  }
  function docPointingAt(fileUrl: string) {
    h.doc = {
      id: "d1",
      clinicId: "c1",
      patientId: "p1",
      type: "RESULT",
      fileUrl,
      uploadedById: "u_doc",
    };
  }

  it("removes its own object when nothing else uses it", async () => {
    docPointingAt(OWN_URL);
    expect((await del()).status).toBe(200);
    expect(h.deletedKeys).toEqual([OWN_KEY]);
  });

  it("a fileUrl copied from another document does not take that document's file with it", async () => {
    docPointingAt(OWN_URL);
    h.keyInUseBy = OWN_KEY;
    expect((await del()).status).toBe(200);
    expect(h.deletedKeys).toHaveLength(0);
  });

  it("never deletes another clinic's object", async () => {
    docPointingAt("https://neurofax.uz/files/medbook/clinics/c2/documents/their.pdf");
    expect((await del()).status).toBe(200);
    expect(h.deletedKeys).toHaveLength(0);
  });
});

describe("send-telegram reads only this clinic's objects in the main bucket", () => {
  function send() {
    return sendTelegram(
      new Request("https://neurofax.uz/api/crm/visit-notes/vn1/send-telegram", {
        method: "POST",
      }),
    );
  }

  it("skips a document pointing at another clinic or bucket, sends its own", async () => {
    h.documentsOfVisit = [
      { id: "d_own", title: "Заключение", fileUrl: OWN_URL, mimeType: "application/pdf" },
      {
        id: "d_foreign",
        title: "чужое",
        fileUrl: "https://neurofax.uz/files/medbook/clinics/c2/documents/their.pdf",
        mimeType: "application/pdf",
      },
      {
        id: "d_bucket",
        title: "бэкап",
        fileUrl: "https://neurofax.uz/files/backups/db/dump.sql",
        mimeType: null,
      },
    ];
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, failed: 2 });
    expect(h.fetched).toEqual([{ bucket: undefined, key: OWN_KEY }]);
  });

  it("a pack shot is read only from this clinic's drug photos", async () => {
    h.documentsOfVisit = [
      { id: "d_own", title: "Заключение", fileUrl: OWN_URL, mimeType: "application/pdf" },
    ];
    h.packPhoto = "https://neurofax.uz/files/medbook/clinics/c2/documents/their.pdf";
    await send();
    expect(h.fetched.map((f) => f.key)).toEqual([OWN_KEY]);
  });

  it("clinicReadableKey never trusts the bucket in the URL", () => {
    expect(
      clinicReadableKey("https://neurofax.uz/files/other-bucket/clinics/c1/x.pdf", "c1", "document"),
    ).toBe("clinics/c1/x.pdf");
    expect(clinicReadableKey("https://neurofax.uz/files/medbook/drugs/c1/d/p.jpg", "c1", "packShot")).toBe(
      "drugs/c1/d/p.jpg",
    );
    expect(clinicReadableKey("https://neurofax.uz/files/medbook/drugs/c1/d/p.jpg", "c1", "document")).toBeNull();
    expect(clinicReadableKey("https://neurofax.uz/files/medbook/drugs/c2/d/p.jpg", "c1", "packShot")).toBeNull();
  });
});

describe("documentHref (staff pages open only safe URLs)", () => {
  it("maps stored objects to our proxy and lets https and /api/ through", () => {
    expect(documentHref(OWN_URL)).toBe(`/api/crm/documents/file?key=${encodeURIComponent(OWN_KEY)}`);
    expect(documentHref("https://lab.example/r/1.pdf")).toBe("https://lab.example/r/1.pdf");
    expect(documentHref("/api/crm/documents/file?key=x")).toBe("/api/crm/documents/file?key=x");
    expect(documentHref("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("refuses script, plain http, html data and protocol-relative values", () => {
    for (const bad of [
      "javascript:alert(document.cookie)",
      " JaVaScRiPt:alert(1)",
      "http://lab.example/r/1.pdf",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example/x",
      "pending://upload",
      "",
      null,
    ]) {
      expect(documentHref(bad), String(bad)).toBeNull();
    }
  });
});
