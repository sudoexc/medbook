/**
 * Audit CM-05 — the library upload no longer leaves orphans and keeps the
 * file's type and size.
 *
 *   - DELETE /api/crm/documents/upload takes back bytes whose document was
 *     not saved: only with the upload's receipt, only this clinic's folder,
 *     never an object a document already uses.
 *   - The dialog picks the patient by search (no «ID cmXXX…» field), sends
 *     the upload's mimeType / sizeBytes, and calls the DELETE on a failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleted: [] as string[],
  inUse: false,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_r", role: "RECEPTIONIST", clinicId: "c1", email: "r@example.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_r", role: "RECEPTIONIST" }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/storage/minio", () => ({
  deleteObject: vi.fn(async (_bucket: unknown, key: string) => {
    h.deleted.push(key);
  }),
  uploadObject: vi.fn(),
  isStubMode: () => false,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: { findFirst: vi.fn(async () => (h.inUse ? { id: "doc_1" } : null)) },
    doctor: { findFirst: vi.fn(async () => null) },
  },
}));

import { signDocumentUpload } from "@/server/documents/file-ref";

const KEY = "clinics/c1/documents/abc-scan.pdf";
const URL_ = `https://s3.example.test/medbook/${KEY}`;

async function discard(body: unknown): Promise<Response> {
  const { DELETE } = await import("@/app/api/crm/documents/upload/route");
  return DELETE(
    new Request("https://x/api/crm/documents/upload", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  process.env.APP_SECRET = process.env.APP_SECRET || "test-app-secret";
  h.deleted = [];
  h.inUse = false;
});

describe("DELETE /api/crm/documents/upload", () => {
  it("removes the clinic's own unused upload with its receipt", async () => {
    const res = await discard({ fileUrl: URL_, uploadToken: signDocumentUpload("c1", KEY) });
    expect(res.status).toBe(200);
    expect(h.deleted).toEqual([KEY]);
  });

  it("refuses without a valid receipt, or another clinic's receipt", async () => {
    expect((await discard({ fileUrl: URL_, uploadToken: "1.bogus" })).status).toBe(400);
    const otherKey = "clinics/c2/documents/x.pdf";
    expect(
      (
        await discard({
          fileUrl: `https://s3.example.test/medbook/${otherKey}`,
          uploadToken: signDocumentUpload("c2", otherKey),
        })
      ).status,
    ).toBe(400);
    expect(h.deleted).toEqual([]);
  });

  it("never removes an object a document already uses", async () => {
    h.inUse = true;
    const res = await discard({ fileUrl: URL_, uploadToken: signDocumentUpload("c1", KEY) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: false });
    expect(h.deleted).toEqual([]);
  });
});

describe("the upload dialog", () => {
  const dialog = readFileSync(
    join(process.cwd(), "src/app/[locale]/crm/documents/_components/upload-dialog.tsx"),
    "utf8",
  );

  it("picks the patient by search, never by internal id", () => {
    expect(dialog).not.toContain('placeholder="cmXXX');
    expect(dialog).toContain("<PatientPicker");
  });

  it("sends the upload's type and size, and takes the bytes back on failure", () => {
    expect(dialog).toMatch(/CreateDocumentSchema\.safeParse\(\{[\s\S]*mimeType,[\s\S]*sizeBytes,/);
    expect(dialog).toContain("discardDocumentUpload(storedUrl, uploadToken)");
  });
});
