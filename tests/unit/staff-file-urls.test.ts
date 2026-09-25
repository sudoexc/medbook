/**
 * Audit CD-02: files opened by their bare MinIO URL.
 *
 * The bucket is private: the URL `uploadObject` returns answers AccessDenied,
 * and a presigned one breaks on nginx's `/files/` rewrite. Documents in the
 * doctor's cabinet and the CRM library, the doctor's signature preview, the
 * clinic letterhead and logo on printouts and the drug pack photos all used
 * that URL as is. Now:
 *   - every API that hands a stored file URL to a staff page returns our
 *     streaming proxy URL (`/api/crm/documents/file?key=…`);
 *   - the proxy serves any folder the caller's clinic owns and nothing else;
 *   - print pages embed images as data: URIs;
 *   - the DSAR bundle streams instead of redirecting to a presigned URL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isClinicOwnedKey,
  staffFileHref,
  staffKeyHref,
  storageKeyFromUrl,
} from "@/lib/storage-ref";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');

const state = {
  objects: new Map<string, Uint8Array>(),
  fetched: [] as Array<{ bucket: string | undefined; key: string }>,
  document: null as Record<string, unknown> | null,
  exportJob: null as Record<string, unknown> | null,
  exportUpdates: 0,
  audits: [] as string[],
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_admin", role: "ADMIN", clinicId: "c1", email: "a@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_admin",
    role: "ADMIN" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, e: { action: string }) => {
    state.audits.push(e.action);
  }),
}));
vi.mock("@/server/storage/minio", () => ({
  fetchObject: vi.fn(async (bucket: string | undefined, key: string) => {
    state.fetched.push({ bucket, key });
    const bytes = state.objects.get(key);
    if (!bytes) {
      const e = new Error("missing") as NodeJS.ErrnoException;
      e.code = "ENOENT";
      throw e;
    }
    return {
      body: new Response(bytes as unknown as BodyInit).body,
      contentType: "application/octet-stream",
      contentLength: bytes.byteLength,
    };
  }),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: { findUnique: vi.fn(async () => state.document) },
    dataExportJob: {
      findFirst: vi.fn(async () => state.exportJob),
      update: vi.fn(async () => {
        state.exportUpdates += 1;
        return { downloadCount: state.exportUpdates };
      }),
    },
  },
}));

beforeEach(() => {
  state.objects = new Map();
  state.fetched = [];
  state.document = null;
  state.exportJob = null;
  state.exportUpdates = 0;
  state.audits = [];
});

// ----- the shared parser ---------------------------------------------------

describe("storageKeyFromUrl: every URL shape we ever stored", () => {
  it.each([
    [
      "https://neurofax.uz/files/medbook/clinics/c1/documents/a b.pdf",
      "clinics/c1/documents/a b.pdf",
    ],
    [
      "https://files.neurofax.uz/medbook/drugs/c1/drug_1/x.png",
      "drugs/c1/drug_1/x.png",
    ],
    [
      "file:///tmp/medbook-uploads/medbook/letterhead/c1/l.png",
      "letterhead/c1/l.png",
    ],
    [
      "/api/crm/documents/file?key=clinics%2Fc1%2Fdocuments%2Fx.pdf",
      "clinics/c1/documents/x.pdf",
    ],
    [
      "https://neurofax.uz/api/crm/documents/file?key=branding/c1/logo.png",
      "branding/c1/logo.png",
    ],
  ])("%s", (url, key) => {
    expect(storageKeyFromUrl(url)).toBe(key);
  });

  it.each([
    ["data:image/png;base64,AAAA"],
    ["/uploads/drugs/c1/x.png"],
    // A foreign URL that merely has /drugs/ deeper in its path.
    ["https://pharm.example/img/catalog/drugs/123/box.jpg"],
    ["/api/crm/documents/file?key=clinics/c1/../c2/x.pdf"],
    ["/api/crm/documents/file?key=exports/c1/x.zip"],
    [""],
    [null],
  ])("not ours: %s", (url) => {
    expect(storageKeyFromUrl(url)).toBeNull();
  });
});

describe("staffFileHref", () => {
  it("maps a bare bucket URL to our proxy, and is idempotent", () => {
    const href = staffFileHref(
      "https://neurofax.uz/files/medbook/clinics/c1/documents/x.pdf",
    );
    expect(href).toBe(
      "/api/crm/documents/file?key=clinics%2Fc1%2Fdocuments%2Fx.pdf",
    );
    expect(staffFileHref(href)).toBe(href);
    expect(staffFileHref(href, { download: true })).toBe(`${href}&download=1`);
  });

  it("leaves what is not in our storage alone", () => {
    expect(staffFileHref("data:image/png;base64,AA")).toBe(
      "data:image/png;base64,AA",
    );
    expect(staffFileHref("/uploads/x.png")).toBe("/uploads/x.png");
    expect(staffFileHref(null)).toBeNull();
  });

  it("owns only the caller's clinic folders", () => {
    expect(isClinicOwnedKey("drugs/c1/d/x.png", "c1")).toBe(true);
    expect(isClinicOwnedKey("clinics/c2/documents/x.pdf", "c1")).toBe(false);
    expect(isClinicOwnedKey("exports/c1/x.zip", "c1")).toBe(false);
  });
});

// ----- the proxy route -----------------------------------------------------

describe("GET /api/crm/documents/file", () => {
  async function get(key: string): Promise<Response> {
    vi.resetModules();
    const { GET } = await import("@/app/api/crm/documents/file/route");
    return GET(
      new Request(
        `https://x${staffKeyHref(key)}`,
      ),
    );
  }

  it("serves a pack photo and a letterhead of the caller's clinic inline", async () => {
    state.objects.set("drugs/c1/drug_1/x.png", PNG);
    state.objects.set("letterhead/c1/l.png", PNG);
    for (const key of ["drugs/c1/drug_1/x.png", "letterhead/c1/l.png"]) {
      const res = await get(key);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("refuses another clinic's files and non-clinic folders", async () => {
    expect((await get("clinics/c2/documents/x.pdf")).status).toBe(403);
    expect((await get("drugs/c2/d/x.png")).status).toBe(403);
    expect((await get("exports/c1/x.zip")).status).toBe(403);
    expect(state.fetched).toHaveLength(0);
  });
});

describe("GET /api/crm/documents/[id]", () => {
  it("returns the proxy URL, never the bucket URL", async () => {
    state.document = {
      id: "doc_1",
      fileUrl: "https://neurofax.uz/files/medbook/clinics/c1/documents/mri.pdf",
    };
    vi.resetModules();
    const { GET } = await import("@/app/api/crm/documents/[id]/route");
    const res = await GET(new Request("https://x/api/crm/documents/doc_1"));
    const row = (await res.json()) as { fileUrl: string };
    expect(row.fileUrl).toBe(
      "/api/crm/documents/file?key=clinics%2Fc1%2Fdocuments%2Fmri.pdf",
    );
  });
});

// ----- printouts -----------------------------------------------------------

describe("inlineStorageImage (print pages)", () => {
  it("embeds a raster image of the clinic as a data: URI", async () => {
    state.objects.set("clinics/c1/documents/sig.png", PNG);
    const { inlineStorageImage } = await import(
      "@/server/storage/inline-image"
    );
    const src = await inlineStorageImage(
      "https://neurofax.uz/files/medbook/clinics/c1/documents/sig.png",
      "c1",
    );
    expect(src).toMatch(/^data:image\/png;base64,/);
  });

  it("never inlines an SVG, another clinic's file, or a missing object", async () => {
    state.objects.set("branding/c1/logo.svg", SVG);
    state.objects.set("branding/c2/logo.png", PNG);
    const { inlineStorageImage } = await import(
      "@/server/storage/inline-image"
    );
    expect(
      await inlineStorageImage("/api/crm/documents/file?key=branding/c1/logo.svg", "c1"),
    ).toBeNull();
    expect(
      await inlineStorageImage("/api/crm/documents/file?key=branding/c2/logo.png", "c1"),
    ).toBeNull();
    expect(
      await inlineStorageImage("/api/crm/documents/file?key=branding/c1/none.png", "c1"),
    ).toBeNull();
  });

  it("passes through what is not in our storage", async () => {
    const { inlineStorageImage } = await import(
      "@/server/storage/inline-image"
    );
    expect(await inlineStorageImage("/uploads/letterhead/c1/l.png", "c1")).toBe(
      "/uploads/letterhead/c1/l.png",
    );
    expect(await inlineStorageImage(null, "c1")).toBeNull();
  });
});

// ----- DSAR bundle ---------------------------------------------------------

describe("GET /api/crm/dsar/exports/[id]/download", () => {
  it("streams the bundle as an attachment and counts the download", async () => {
    state.exportJob = {
      id: "job_1",
      patientId: "p1",
      storageKey: "exports/c1/job_1.zip",
      status: "READY",
      downloadCount: 0,
    };
    state.objects.set("exports/c1/job_1.zip", new Uint8Array([0x50, 0x4b, 3, 4]));
    vi.resetModules();
    const { GET } = await import(
      "@/app/api/crm/dsar/exports/[id]/download/route"
    );

    const res = await GET(
      new Request("https://x/api/crm/dsar/exports/job_1/download"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(state.exportUpdates).toBe(1);
    expect(state.audits).toContain("PATIENT_DATA_EXPORT_DOWNLOADED");
    expect(state.fetched[0]?.key).toBe("exports/c1/job_1.zip");
  });
});
