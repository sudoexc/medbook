/**
 * Audit CD-09 (review of CD-05): a signed record filed by mistake is voided
 * by ADMIN instead of deleted. It stays in the chart for the audit trail,
 * but the patient's Mini App must stop listing and serving it: on the wrong
 * patient's card it is someone else's signature. The numbering the patient
 * sees keeps matching the CRM's `#N`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = {
  clinicId: "c1",
  clinicSlug: "neurofax",
  patientId: "p1",
  patient: { preferredLang: "RU" },
};

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  findFirstWhere: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/miniapp/handler", () => ({
  resolveMiniAppContext: vi.fn(async () => ({ ok: true, ctx: CTX })),
  resolveMiniAppLink: vi.fn(async () => ({
    ok: true,
    link: { clinicId: "c1", patientId: "p1" },
  })),
  createMiniAppListHandler:
    (_o: unknown, fn: (a: { request: Request; ctx: typeof CTX }) => Promise<Response>) =>
    (request: Request) =>
      fn({ request, ctx: CTX }),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    ownerPatientId: "p1",
  })),
}));
vi.mock("@/server/miniapp/link-token", () => ({
  miniAppDocumentUrl: ({ documentId }: { documentId: string }) => `/doc/${documentId}`,
}));
vi.mock("@/server/miniapp/link-page", () => ({
  expiredMiniAppLinkPage: (status: number) => new Response(null, { status }),
}));
vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(),
  fetchObject: vi.fn(async () => ({ body: "bytes", contentType: "image/png" })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findMany: vi.fn(async () => h.rows),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.findFirstWhere = where;
        const row = h.rows.find((r) => r.id === where.id);
        if (!row) return null;
        if ("voidedAt" in where && where.voidedAt === null && row.voidedAt != null) {
          return null;
        }
        return row;
      }),
    },
  },
}));

import { GET as LIST } from "@/app/api/miniapp/documents/route";
import { GET as FILE } from "@/app/api/miniapp/documents/[id]/file/route";

const FILE_URL = "https://neurofax.uz/files/medbook/clinics/c1/documents/x.png";

function row(id: string, voidedAt: Date | null) {
  return {
    id,
    type: "CONSENT",
    title: id,
    fileUrl: FILE_URL,
    mimeType: "image/png",
    sizeBytes: 10,
    createdAt: new Date("2026-10-01T09:00:00Z"),
    voidedAt,
  };
}

beforeEach(() => {
  // Newest first, as the route orders them.
  h.rows = [row("d3", null), row("d2", new Date()), row("d1", null)];
  h.findFirstWhere = null;
});

describe("Mini App documents list", () => {
  it("leaves a voided document out and keeps the CRM's numbering", async () => {
    const res = await LIST(
      new Request("https://neurofax.uz/api/miniapp/documents?clinicSlug=neurofax"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      documents: Array<{ id: string; seq: number; voidedAt?: unknown }>;
    };
    expect(body.documents.map((d) => [d.id, d.seq])).toEqual([
      ["d3", 3],
      ["d1", 1],
    ]);
    // The void itself is the clinic's business, not a field for the patient.
    expect(body.documents[0]).not.toHaveProperty("voidedAt");
  });
});

describe("Mini App document file", () => {
  const open = (id: string) =>
    FILE(
      new Request(`https://neurofax.uz/api/miniapp/documents/${id}/file?clinicSlug=neurofax&t=link`),
      { params: Promise.resolve({ id }) },
    );

  it("an old link to a voided document opens nothing", async () => {
    const res = await open("d2");
    expect(res.status).toBe(404);
    expect(h.findFirstWhere).toMatchObject({ id: "d2", voidedAt: null });
  });

  it("a valid document still streams", async () => {
    const res = await open("d1");
    expect(res.status).toBe(200);
  });
});
