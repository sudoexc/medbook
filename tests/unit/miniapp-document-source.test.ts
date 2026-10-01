/**
 * Audit CD-06: where a document came from.
 *
 * `uploadedById = null` stood for «from the patient», but the conclusion and
 * referral workers write null too: every rendered conclusion carried the
 * «От пациента» badge, while a patient's own MRI photo filed as «Результат»
 * or «Согласие» looked like a clinical document to the doctor. Pinned here:
 * the Mini App stores `source = PATIENT` and only RESULT/OTHER (any other
 * type becomes OTHER), the workers write SYSTEM, and the migration backfills
 * existing rows by the same rules.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/miniapp/handler", () => ({
  resolveMiniAppContext: vi.fn(async () => ({
    ok: true,
    ctx: {
      clinicId: "c1",
      clinicSlug: "neurofax",
      patientId: "p1",
      patient: { preferredLang: "RU" },
    },
  })),
  createMiniAppListHandler: () => async () => new Response(null),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    ownerPatientId: "p1",
  })),
  getFamilyAllowedPatientIds: vi.fn(async () => ["p1"]),
}));
vi.mock("@/server/storage/safe-file", () => ({
  DOCUMENT_TYPES: ["image/png"],
  checkUpload: () => ({ ok: true, mime: "image/png" }),
}));
vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(async () => ({ url: "http://minio/b/k.png" })),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/miniapp/link-token", () => ({ miniAppDocumentUrl: () => "/x" }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => {
  const document = {
    aggregate: vi.fn(async () => ({ _sum: { sizeBytes: 0 } })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      h.created.push(data);
      return { id: "d1", createdAt: new Date(), ...data };
    }),
  };
  const auditLog = { create: vi.fn(async ({ data }: { data: unknown }) => data) };
  const $queryRaw = vi.fn(async () => []);
  return {
    prisma: {
      document,
      auditLog,
      $queryRaw,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ document, auditLog, $queryRaw }),
      ),
    },
  };
});

import { POST } from "@/app/api/miniapp/documents/route";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

function upload(type?: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(1024)], "scan.png", { type: "image/png" }));
  if (type) form.append("type", type);
  return POST(
    new Request("https://neurofax.uz/api/miniapp/documents?clinicSlug=neurofax", {
      method: "POST",
      body: form,
    }),
  );
}

beforeEach(() => {
  __resetRateLimitsForTests();
  h.created = [];
});

describe("Mini App upload (CD-06)", () => {
  it("is stored as the patient's, with no staff uploader", async () => {
    const res = await upload("RESULT");
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({
      source: "PATIENT",
      uploadedById: null,
      type: "RESULT",
    });
  });

  it("a consent, contract, prescription or referral sent by the patient is stored as OTHER", async () => {
    for (const type of ["CONSENT", "CONTRACT", "PRESCRIPTION", "REFERRAL", "RECEIPT", "CONCLUSION"]) {
      h.created = [];
      const res = await upload(type);
      expect(res.status, type).toBe(201);
      expect(h.created[0]?.type, type).toBe("OTHER");
    }
  });

  it("no type is OTHER", async () => {
    await upload();
    expect(h.created[0]?.type).toBe("OTHER");
  });
});

describe("rendered documents and the backfill (CD-06)", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (p: string) => readFileSync(path.join(root, p), "utf8");

  it("the conclusion and referral workers write SYSTEM", () => {
    for (const file of [
      "src/server/workers/visit-note-handout.ts",
      "src/server/workers/referral-document.ts",
    ]) {
      expect(read(file), file).toMatch(/uploadedById: null,\s*\/\/[^\n]*\n\s*source: "SYSTEM"/);
    }
  });

  it("the migration backfills SYSTEM for rendered rows before PATIENT for the rest", () => {
    const sql = read("prisma/migrations/20261001210000_document_source/migration.sql");
    const system = sql.indexOf(`SET "source" = 'SYSTEM'`);
    const patient = sql.indexOf(`SET "source" = 'PATIENT'`);
    expect(system).toBeGreaterThan(0);
    expect(patient).toBeGreaterThan(system);
    expect(sql).toMatch(/"type" = 'CONCLUSION'/);
    expect(sql).toMatch(/"verifyToken" IS NOT NULL/);
    expect(sql.slice(patient)).toMatch(/"uploadedById" IS NULL\s+AND "source" = 'STAFF'/);
    // Safe on existing rows: NOT NULL with a default.
    expect(sql).toMatch(/ADD COLUMN\s+"source" "DocumentSource" NOT NULL DEFAULT 'STAFF'/);
  });
});
