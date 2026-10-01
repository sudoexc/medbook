/**
 * Audit PT-07: a DSAR erasure left the person in leads, site requests,
 * notification texts and files; HARD_DELETE failed on RESTRICT keys and
 * stayed APPROVED forever (fifty of those blocked the batch); no failure
 * state; no request from the card.
 *
 * Acceptance: after anonymization, the old phone or name finds no lead,
 * request or notification; a HARD_DELETE request completes (as an
 * anonymization, without deleting the card) and a job that keeps failing
 * ends FAILED, not retried forever.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { model: string; op: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  job: null as null | Record<string, unknown>,
  patient: null as null | Record<string, unknown>,
  docs: [] as Array<{ id: string; fileUrl: string }>,
  revisions: [] as Array<{ id: string; pdfObjectKey: string | null }>,
  deletedObjects: [] as string[],
  failStorage: false,
  audits: [] as Array<Record<string, unknown>>,
  due: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/queue", () => ({ getQueue: vi.fn() }));
vi.mock("@/server/storage/minio", () => ({
  deleteObject: vi.fn(async (_b: unknown, key: string) => {
    if (state.failStorage) throw new Error("storage unavailable");
    state.deletedObjects.push(key);
  }),
}));
vi.mock("@/server/dsar/audit-scrub", () => ({
  scrubPatientFromAuditLog: vi.fn(async () => undefined),
}));
vi.mock("@/server/patient/cipher-fields", () => ({
  hydratePatientForRead: (p: { passport: string | null }) => p,
}));
vi.mock("@/lib/prisma", () => {
  const rec = (model: string, op: string, result: unknown = { count: 1 }) =>
    vi.fn(async (args: Record<string, unknown>) => {
      state.calls.push({ model, op, args });
      return typeof result === "function" ? (result as (a: unknown) => unknown)(args) : result;
    });
  return {
    prisma: {
      dataDeletionJob: {
        findUnique: vi.fn(async () => state.job),
        findMany: vi.fn(async (args: Record<string, unknown>) => {
          state.calls.push({ model: "dataDeletionJob", op: "findMany", args });
          return state.due;
        }),
        update: rec("dataDeletionJob", "update", {}),
      },
      dataExportJob: { findMany: vi.fn(async () => []), update: vi.fn() },
      patient: {
        findUnique: vi.fn(async () => state.patient),
        update: rec("patient", "update", {}),
        delete: rec("patient", "delete", {}),
      },
      medicalCase: { updateMany: rec("medicalCase", "updateMany") },
      appointment: { updateMany: rec("appointment", "updateMany") },
      patientReview: { updateMany: rec("patientReview", "updateMany") },
      conversation: {
        findMany: vi.fn(async () => []),
        updateMany: rec("conversation", "updateMany"),
      },
      message: { updateMany: rec("message", "updateMany") },
      patientClinicalNote: { deleteMany: rec("patientClinicalNote", "deleteMany") },
      lead: { updateMany: rec("lead", "updateMany") },
      onlineRequest: { updateMany: rec("onlineRequest", "updateMany") },
      notificationSend: { updateMany: rec("notificationSend", "updateMany") },
      communication: { updateMany: rec("communication", "updateMany") },
      call: { updateMany: rec("call", "updateMany") },
      review: { updateMany: rec("review", "updateMany") },
      document: {
        findMany: vi.fn(async () => state.docs),
        delete: rec("document", "delete", {}),
      },
      visitNoteRevision: {
        findMany: vi.fn(async () => state.revisions),
        update: rec("visitNoteRevision", "update", {}),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.audits.push(data);
          return data;
        }),
      },
    },
  };
});

import {
  MAX_DELETION_ATTEMPTS,
  executeDeletionJob,
  recordDeletionFailure,
  runDsarTick,
} from "@/server/workers/data-deletion";
import { buildAnonymizationPayload } from "@/server/dsar/anonymize";

const due = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  state.calls = [];
  state.audits = [];
  state.deletedObjects = [];
  state.failStorage = false;
  state.due = [];
  state.job = {
    id: "job_1",
    clinicId: "c1",
    patientId: "p1",
    status: "APPROVED",
    mode: "ANONYMIZE",
    scheduledFor: due,
  };
  state.patient = {
    id: "p1",
    fullName: "Иванов Иван",
    phone: "+998 90 123 45 67",
    phoneNormalized: "+998901234567",
    telegramId: null,
    telegramUsername: null,
    passport: null,
  };
  state.docs = [
    { id: "d1", fileUrl: "https://neurofax.uz/files/medbook/clinics/c1/documents/scan.pdf" },
    { id: "d2", fileUrl: "/api/crm/documents/file?key=clinics%2Fc1%2Fvisit-notes%2Fvn1.pdf" },
  ];
  state.revisions = [{ id: "r1", pdfObjectKey: "clinics/c1/visit-notes/vn1-r1.pdf" }];
});

const callsOf = (model: string) => state.calls.filter((c) => c.model === model);

describe("what an erasure reaches", () => {
  it("leads and requests by card and by the card's phone, pinned to the clinic", async () => {
    await executeDeletionJob("job_1");
    for (const model of ["lead", "onlineRequest"]) {
      const [c] = callsOf(model);
      expect(c!.args.where).toEqual({
        OR: [
          { patientId: "p1" },
          { clinicId: "c1", phone: { in: ["+998 90 123 45 67", "+998901234567"] } },
        ],
      });
      expect(c!.args.data).toMatchObject({ name: "Удалённый пациент", phone: "", comment: null });
    }
  });

  it("notification texts, communication bodies, calls and review links", async () => {
    await executeDeletionJob("job_1");
    expect(callsOf("notificationSend")[0]!.args).toMatchObject({
      where: { patientId: "p1" },
      data: { body: "", recipient: "" },
    });
    expect(callsOf("communication")[0]!.args).toMatchObject({
      where: { patientId: "p1" },
      data: { body: null, subject: null },
    });
    const calls = callsOf("call").map((c) => c.args);
    expect(calls).toContainEqual({
      where: { patientId: "p1" },
      data: { summary: null, recordingUrl: null, tags: [] },
    });
    expect(calls).toContainEqual({
      where: { patientId: "p1", direction: { in: ["IN", "MISSED"] } },
      data: { fromNumber: "" },
    });
    expect(callsOf("review")[0]!.args).toEqual({
      where: { patientId: "p1" },
      data: { patientId: null },
    });
  });

  it("every file: documents (object then row) and issued conclusion PDFs", async () => {
    await executeDeletionJob("job_1");
    expect(state.deletedObjects).toEqual([
      "clinics/c1/documents/scan.pdf",
      "clinics/c1/visit-notes/vn1.pdf",
      "clinics/c1/visit-notes/vn1-r1.pdf",
    ]);
    expect(callsOf("document").map((c) => c.args.where)).toEqual([{ id: "d1" }, { id: "d2" }]);
    expect(callsOf("visitNoteRevision")[0]!.args).toEqual({
      where: { id: "r1" },
      data: { pdfObjectKey: null },
    });
  });

  it("the carriers are scrubbed before the card loses the phone they are found by", async () => {
    await executeDeletionJob("job_1");
    const order = state.calls.map((c) => c.model);
    expect(order.indexOf("lead")).toBeLessThan(order.indexOf("patient"));
    expect(callsOf("patient")[0]!.args.data).toMatchObject({
      fullName: "Удалённый пациент",
      birthDate: null,
      phoneVerifiedAt: null,
    });
  });

  it("a storage failure throws (the job retries) instead of dropping the row", async () => {
    state.failStorage = true;
    await expect(executeDeletionJob("job_1")).rejects.toThrow("storage unavailable");
    expect(callsOf("document")).toEqual([]);
    expect(callsOf("patient")).toEqual([]);
  });

  it("the anonymised card has no birth date or verification stamps left", () => {
    expect(buildAnonymizationPayload("j", new Date())).toMatchObject({
      birthDate: null,
      phoneVerifiedAt: null,
      telegramLinkedAt: null,
      tgBlockedAt: null,
    });
  });
});

describe("HARD_DELETE is carried out as an anonymization", () => {
  it("never deletes the card; the job completes as ANONYMIZED and says what was asked", async () => {
    state.job = { ...state.job!, mode: "HARD_DELETE" };
    await executeDeletionJob("job_1");
    expect(callsOf("patient").map((c) => c.op)).toEqual(["update"]);
    expect(callsOf("dataDeletionJob")[0]!.args.data).toMatchObject({ status: "ANONYMIZED" });
    expect(state.audits).toContainEqual(
      expect.objectContaining({
        action: "PATIENT_ANONYMIZED",
        meta: expect.objectContaining({ requestedMode: "HARD_DELETE", executedAs: "ANONYMIZE" }),
      }),
    );
  });

  it("the CRM no longer accepts new HARD_DELETE requests", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/dsar/deletions/route.ts"),
      "utf8",
    );
    expect(src).toContain('mode: z.literal("ANONYMIZE")');
  });
});

describe("a job that keeps failing", () => {
  const row = { id: "job_9", attempts: 0, clinicId: "c1", patientId: "p9" };

  it("counts attempts and ends FAILED with the reason after the last one", async () => {
    await recordDeletionFailure(row, new Error("relation x violates"));
    expect(callsOf("dataDeletionJob").at(-1)!.args.data).toEqual({
      attempts: 1,
      errorMessage: "relation x violates",
    });
    await recordDeletionFailure({ ...row, attempts: MAX_DELETION_ATTEMPTS - 1 }, new Error("again"));
    expect(callsOf("dataDeletionJob").at(-1)!.args.data).toEqual({
      attempts: MAX_DELETION_ATTEMPTS,
      errorMessage: "again",
      status: "FAILED",
    });
    expect(state.audits).toContainEqual(
      expect.objectContaining({ action: "PATIENT_DELETION_FAILED", entityId: "job_9" }),
    );
  });

  it("the tick takes the least-failed jobs first and records a throw", async () => {
    state.due = [{ id: "job_1", attempts: 0, clinicId: "c1", patientId: "p1" }];
    state.failStorage = true;
    await runDsarTick();
    const pick = callsOf("dataDeletionJob").find((c) => c.op === "findMany")!;
    expect(pick.args.orderBy).toEqual([{ attempts: "asc" }, { scheduledFor: "asc" }]);
    expect(callsOf("dataDeletionJob").at(-1)!.args).toMatchObject({
      where: { id: "job_1" },
      data: { attempts: 1, errorMessage: "storage unavailable" },
    });
  });
});

describe("the card side", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("an erased card cannot be edited back to a person", () => {
    expect(read("src/app/api/crm/patients/[id]/route.ts")).toContain(
      'if (before.deletedAt) return conflict("patient_erased")',
    );
  });

  it("an erased card is found by no search", () => {
    expect(read("src/app/api/crm/search/route.ts")).toContain("deletedAt: null");
    expect(read("src/app/api/crm/doctors/me/patients/route.ts")).toContain("deletedAt: null");
  });

  it("a FAILED job is retried by approving it again, and blocks a duplicate", () => {
    const patch = read("src/app/api/crm/dsar/deletions/[id]/route.ts");
    expect(patch).toContain('job.status !== "PENDING_REVIEW" && job.status !== "FAILED"');
    expect(patch).toContain("attempts: 0");
    const post = read("src/app/api/crm/dsar/deletions/route.ts");
    expect(post).toContain('status: { in: ["PENDING_REVIEW", "APPROVED", "FAILED"] }');
  });
});
