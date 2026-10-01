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
 *
 * Review: a number a family shares took the other card's leads with it, and
 * chat attachments (objects and links) and doctors' reminders survived.
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
  convs: [] as Array<{ id: string }>,
  messages: [] as Array<{ conversationId: string; attachments: unknown }>,
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
        findMany: vi.fn(async () => state.convs),
        updateMany: rec("conversation", "updateMany"),
      },
      message: {
        findMany: rec("message", "findMany", () => state.messages),
        updateMany: rec("message", "updateMany"),
      },
      patientClinicalNote: { deleteMany: rec("patientClinicalNote", "deleteMany") },
      eventOutbox: { deleteMany: rec("eventOutbox", "deleteMany") },
      reminder: { deleteMany: rec("reminder", "deleteMany") },
      patientFamily: { deleteMany: rec("patientFamily", "deleteMany") },
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
import { chatAttachmentKey } from "@/lib/storage-ref";
import { Prisma } from "@/generated/prisma/client";

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
  state.convs = [];
  state.messages = [];
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
          {
            clinicId: "c1",
            patientId: null,
            phone: { in: ["+998 90 123 45 67", "+998901234567"] },
          },
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

  it("the Mini App family links, both ways, pinned to the clinic (final review of P5)", async () => {
    // A son managed his mother in «Семья»: after her erasure he still saw
    // her in the switcher and opened her kept record via onBehalfOf.
    await executeDeletionJob("job_1");
    expect(callsOf("patientFamily").map((c) => [c.op, c.args])).toEqual([
      [
        "deleteMany",
        {
          where: {
            clinicId: "c1",
            OR: [{ linkedPatientId: "p1" }, { ownerPatientId: "p1" }],
          },
        },
      ],
    ]);
    const order = state.calls.map((c) => c.model);
    expect(order.indexOf("patientFamily")).toBeLessThan(order.indexOf("patient"));
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

describe("two cards on one number (a family)", () => {
  // The mother owns +998901234567; her son's card keeps it in `phone` with a
  // `contact:` stub as his identity (patients/route.ts, walkin.ts).
  it("erasing the son's card takes only rows linked to him, never by the number", async () => {
    state.patient = {
      ...state.patient!,
      fullName: "Иванов Сардор",
      phone: "+998901234567",
      phoneNormalized: "contact:lx2k9abc12",
    };
    await executeDeletionJob("job_1");
    for (const model of ["lead", "onlineRequest"]) {
      expect(callsOf(model)[0]!.args.where).toEqual({ OR: [{ patientId: "p1" }] });
    }
  });

  it("erasing the mother's card leaves leads already linked to her son", async () => {
    await executeDeletionJob("job_1");
    for (const model of ["lead", "onlineRequest"]) {
      const byNumber = (callsOf(model)[0]!.args.where as { OR: unknown[] }).OR[1];
      // Only rows no card owns are taken by the number.
      expect(byNumber).toMatchObject({ clinicId: "c1", patientId: null });
    }
  });

  it("a card on a family: stub or an already erased card is matched by link only", async () => {
    for (const phoneNormalized of ["family:p0:abc", "deleted:job_0", "tg:555"]) {
      state.calls = [];
      state.patient = { ...state.patient!, phone: "", phoneNormalized };
      await executeDeletionJob("job_1");
      expect(callsOf("lead")[0]!.args.where).toEqual({ OR: [{ patientId: "p1" }] });
    }
  });
});

describe("chat attachments and reminders", () => {
  const proxy = (conv: string, key: string, name: string) =>
    `/api/crm/conversations/${conv}/attachments/file?${new URLSearchParams({ key, name })}`;

  beforeEach(() => {
    state.docs = [];
    state.revisions = [];
    state.convs = [{ id: "conv1" }];
    state.messages = [
      {
        conversationId: "conv1",
        attachments: [
          {
            kind: "image",
            url: proxy("conv1", "clinics/c1/chat/conv1/a1.jpg", "passport.jpg"),
            name: "passport.jpg",
          },
          {
            kind: "file",
            url: proxy("conv1", "clinics/c1/chat/conv1/b2.pdf", "МРТ Иванов.pdf"),
            name: "МРТ Иванов.pdf",
          },
        ],
      },
    ];
  });

  it("deletes every stored object, then drops the links with the bodies", async () => {
    await executeDeletionJob("job_1");
    expect(state.deletedObjects).toEqual([
      "clinics/c1/chat/conv1/a1.jpg",
      "clinics/c1/chat/conv1/b2.pdf",
    ]);
    const [find] = callsOf("message").filter((c) => c.op === "findMany");
    expect(find!.args.where).toMatchObject({ conversationId: { in: ["conv1"] } });
    const [update] = callsOf("message").filter((c) => c.op === "updateMany");
    expect(update!.args).toEqual({
      where: { conversationId: { in: ["conv1"] } },
      data: { body: null, attachments: Prisma.DbNull },
    });
  });

  it("never deletes an object outside the thread's own chat folder", async () => {
    state.messages = [
      {
        conversationId: "conv1",
        attachments: [
          { kind: "file", url: proxy("conv1", "clinics/c2/chat/conv1/x.pdf", "x.pdf") },
          { kind: "file", url: proxy("conv9", "clinics/c1/chat/conv9/y.pdf", "y.pdf") },
          { kind: "file", url: proxy("conv1", "clinics/c1/documents/scan.pdf", "z.pdf") },
          { kind: "image", url: "/uploads/chat/c1/conv1/dev.jpg" },
          { kind: "file" },
        ],
      },
    ];
    await executeDeletionJob("job_1");
    expect(state.deletedObjects).toEqual([]);
    // The links still go: nothing points at those objects from this thread.
    expect(callsOf("message").some((c) => c.op === "updateMany")).toBe(true);
  });

  it("a storage failure keeps the links so the retry still finds the files", async () => {
    state.failStorage = true;
    await expect(executeDeletionJob("job_1")).rejects.toThrow("storage unavailable");
    expect(callsOf("message").filter((c) => c.op === "updateMany")).toEqual([]);
    expect(callsOf("patient")).toEqual([]);
  });

  it("the doctors' reminders about the patient are deleted", async () => {
    await executeDeletionJob("job_1");
    expect(callsOf("reminder")).toEqual([
      { model: "reminder", op: "deleteMany", args: { where: { patientId: "p1" } } },
    ]);
  });

  // Audit INF-04: an event envelope names the patient («пришёл» carries his
  // full name) and stays in the outbox up to a week for the SSE replay.
  it("the realtime events about the patient leave the outbox, in his clinic only", async () => {
    await executeDeletionJob("job_1");
    const calls = callsOf("eventOutbox");
    expect(calls).toHaveLength(1);
    const where = calls[0]!.args.where as { clinicId: string; OR: unknown[] };
    expect(where.clinicId).toBe(state.job!.clinicId);
    expect(where.OR).toEqual([
      { envelope: { path: ["tenantScope", "patientId"], equals: "p1" } },
      { envelope: { path: ["actor", "patientId"], equals: "p1" } },
      { envelope: { path: ["actor", "onBehalfOfPatientId"], equals: "p1" } },
    ]);
  });
});

describe("chatAttachmentKey", () => {
  const scope = { clinicId: "c1", conversationId: "conv1" };

  it("reads the key from the chat proxy URL, relative or absolute", () => {
    const key = "clinics/c1/chat/conv1/a1.jpg";
    const rel = `/api/crm/conversations/conv1/attachments/file?key=${encodeURIComponent(key)}&name=a.jpg`;
    expect(chatAttachmentKey(rel, scope)).toBe(key);
    expect(chatAttachmentKey(`https://neurofax.uz${rel}`, scope)).toBe(key);
  });

  it("refuses keys outside the folder, traversal and the bare folder", () => {
    const at = (key: string) =>
      `/api/crm/conversations/conv1/attachments/file?key=${encodeURIComponent(key)}`;
    expect(chatAttachmentKey(at("clinics/c1/chat/conv1/../conv2/a.jpg"), scope)).toBeNull();
    expect(chatAttachmentKey(at("clinics/c1/chat/conv1/"), scope)).toBeNull();
    expect(chatAttachmentKey(at("clinics/c1/chat/conv10/a.jpg"), scope)).toBeNull();
    expect(chatAttachmentKey(null, scope)).toBeNull();
    expect(chatAttachmentKey("/uploads/chat/c1/conv1/a.jpg", scope)).toBeNull();
  });

  it("also knows a raw storage URL of the same folder", () => {
    expect(
      chatAttachmentKey("https://neurofax.uz/files/medbook/clinics/c1/chat/conv1/v.ogg", scope),
    ).toBe("clinics/c1/chat/conv1/v.ogg");
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
