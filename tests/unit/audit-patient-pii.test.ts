/**
 * Audit SEC-09: the audit log no longer keeps the patient's identity.
 *
 * PATCH /api/crm/patients/[id] diffed the decrypted rows, so every card edit
 * wrote the passport and the notes into AuditLog.meta in plain text;
 * create / delete stored the whole decrypted card; a DSAR anonymization or
 * hard delete stored a «forensic» copy of name, phone, Telegram id and
 * passport, and left every earlier row naming the person.
 *
 * Acceptance: after a PATCH of the passport, AuditLog.meta holds no passport
 * value; after anonymization, searching AuditLog.meta for the patient's full
 * name or phone finds nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  patientSnapshotAuditMeta,
  patientUpdateAuditMeta,
  redactedDiff,
  CASE_NAME_ONLY_FIELDS,
} from "@/server/audit/patient-audit-meta";
import {
  REDACTED,
  identityTerms,
  redactAuditMeta,
} from "@/server/dsar/audit-scrub";

type AuditRow = {
  id: string;
  clinicId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: unknown;
};

const state = vi.hoisted(() => ({
  audits: [] as Array<Record<string, unknown>>,
  before: null as null | Record<string, unknown>,
  log: [] as AuditRow[],
  job: null as null | Record<string, unknown>,
  patient: null as null | Record<string, unknown>,
  jobUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, input: Record<string, unknown>) => {
    state.audits.push(input);
  }),
}));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/server/queue", () => ({ getQueue: vi.fn() }));
vi.mock("@/server/storage/minio", () => ({ deleteObject: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  // `%term%` with LIKE escapes, matched the way ILIKE on meta::text does.
  const likeMatches = (pattern: string, text: string) =>
    text
      .toLowerCase()
      .includes(pattern.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase());
  const patient = {
    findUnique: vi.fn(async () =>
      state.patient ? { ...state.patient } : state.before ? { ...state.before } : null,
    ),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (state.patient) {
        state.patient = { ...state.patient, ...data };
        return state.patient;
      }
      return { ...state.before, ...data };
    }),
    delete: vi.fn(async () => ({})),
  };
  const noop = { updateMany: vi.fn(async () => ({ count: 0 })) };
  return {
    prisma: {
      patient,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ patient })),
      // The audit-log scrub's raw query, on the in-memory log.
      $queryRaw: vi.fn(
        async (_s: TemplateStringsArray, clinicId: string, id: string, patterns: string[]) =>
          state.log
            .filter(
              (r) =>
                r.clinicId === clinicId &&
                r.meta !== null &&
                (r.entityId === id ||
                  patterns.some((p) => likeMatches(p, JSON.stringify(r.meta)))),
            )
            .map((r) => ({ id: r.id, entityId: r.entityId, meta: r.meta })),
      ),
      auditLog: {
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { meta: unknown } }) => {
          const row = state.log.find((r) => r.id === where.id)!;
          row.meta = data.meta;
          return row;
        }),
        create: vi.fn(async ({ data }: { data: AuditRow }) => {
          state.log.push({ ...data, id: `new-${state.log.length}` });
          return data;
        }),
      },
      dataDeletionJob: {
        findUnique: vi.fn(async () => state.job),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.jobUpdates.push(data);
          return data;
        }),
      },
      medicalCase: noop,
      appointment: noop,
      patientReview: noop,
      message: noop,
      conversation: { ...noop, findMany: vi.fn(async () => []) },
      patientClinicalNote: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      eventOutbox: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      reminder: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      // The other carriers (audit PT-07) are pinned in p5-dsar-erasure.test.ts.
      lead: noop,
      onlineRequest: noop,
      notificationSend: noop,
      communication: noop,
      call: noop,
      review: noop,
      document: { findMany: vi.fn(async () => []), delete: vi.fn() },
      visitNoteRevision: { findMany: vi.fn(async () => []), update: vi.fn() },
    },
  };
});

const CARD = {
  id: "p1",
  clinicId: "c1",
  patientNumber: 7,
  fullName: "Турматов Отабек",
  phone: "+998 90 123-45-67",
  phoneNormalized: "+998901234567",
  phoneVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  passport: "AB7654321",
  notes: "аллергия на анальгин",
  address: "Ташкент, Чиланзар 5",
  birthDate: new Date("1969-01-01T00:00:00Z"),
  telegramId: "555001",
  telegramUsername: "otabek_t",
  segment: "NEW",
  tags: [] as string[],
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

beforeEach(() => {
  state.audits = [];
  state.before = { ...CARD };
  state.log = [];
  state.job = null;
  state.patient = null;
  state.jobUpdates = [];
});

describe("patient.update", () => {
  it("a new passport is named, never written; other settings keep their values", async () => {
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    const res = await PATCH(
      new Request("https://x/api/crm/patients/p1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passport: "AC0000001", segment: "VIP" }),
      }),
    );
    expect(res.status).toBe(200);
    const row = state.audits.find((a) => a.action === "patient.update")!;
    const meta = JSON.stringify(row.meta);
    expect(meta).not.toContain("AB7654321");
    expect(meta).not.toContain("AC0000001");
    expect(meta).not.toContain("анальгин");
    expect(row.meta).toEqual({
      changed: ["passport", "segment"],
      before: { segment: "NEW" },
      after: { segment: "VIP" },
    });
  });

  it("a re-saved identical passport is not a change (the rows are compared decrypted)", () => {
    const meta = patientUpdateAuditMeta(
      { passport: "AB1", segment: "NEW", updatedAt: new Date(1) },
      { passport: "AB1", segment: "NEW", updatedAt: new Date(2) },
    );
    expect(meta).toEqual({ changed: [], before: {}, after: {} });
  });
});

describe("patient.create / patient.delete snapshot", () => {
  it("keeps the card number and settings, names the identity fields", () => {
    const meta = patientSnapshotAuditMeta(CARD);
    const text = JSON.stringify(meta);
    for (const v of ["Турматов", "123-45-67", "AB7654321", "анальгин", "Чиланзар", "555001", "otabek_t"]) {
      expect(text).not.toContain(v);
    }
    expect(meta.card).toMatchObject({ patientNumber: 7, segment: "NEW" });
    expect(meta.filled).toEqual(
      expect.arrayContaining(["fullName", "phone", "passport", "notes", "address", "birthDate"]),
    );
  });
});

describe("medical_case audit rows", () => {
  it("carry neither the patient include nor the SOAP draft text", () => {
    const meta = redactedDiff(
      { title: "Головная боль", soapDraft: "S: жалобы", patient: { fullName: "Турматов Отабек" } },
      { title: "Мигрень", soapDraft: "S: жалобы, тошнота", patient: { fullName: "Турматов Отабек" } },
      CASE_NAME_ONLY_FIELDS,
    );
    expect(meta).toEqual({
      changed: ["title", "soapDraft"],
      before: { title: "Головная боль" },
      after: { title: "Мигрень" },
    });
  });
});

describe("the audit-log scrub", () => {
  const identity = {
    id: "p1",
    fullName: CARD.fullName,
    phone: CARD.phone,
    phoneNormalized: CARD.phoneNormalized,
    passport: CARD.passport,
    telegramId: CARD.telegramId,
    telegramUsername: CARD.telegramUsername,
  };

  it("short identifiers are not searched for: they would erase unrelated text", () => {
    expect(identityTerms({ ...identity, fullName: "Али", telegramUsername: "ab" })).not.toContain(
      "али",
    );
    expect(identityTerms({ ...identity, phoneNormalized: "deleted:job1" })).not.toContain(
      "deleted:job1",
    );
  });

  it("the patient's own rows lose every identity value; other rows only the matching strings", () => {
    const terms = identityTerms(identity);
    const own = redactAuditMeta(
      { before: { address: "Чиланзар", segment: "NEW" }, after: { address: "Юнусабад", segment: "VIP" } },
      terms,
      { ownRow: true },
    );
    expect(own.meta).toEqual({
      before: { address: REDACTED, segment: "NEW" },
      after: { address: REDACTED, segment: "VIP" },
    });
    const other = redactAuditMeta(
      { after: { title: "Мигрень", patient: { id: "p1", fullName: "Турматов Отабек", phone: "+998 90 123-45-67" } } },
      terms,
      { ownRow: false },
    );
    expect(other.meta).toEqual({
      after: { title: "Мигрень", patient: { id: "p1", fullName: REDACTED, phone: REDACTED } },
    });
    const untouched = redactAuditMeta({ appointmentId: "a1" }, terms, { ownRow: false });
    expect(untouched.changed).toBe(false);
  });
});

describe("DSAR anonymization", () => {
  it("leaves nothing in AuditLog.meta that finds the patient by name or phone", async () => {
    state.job = {
      id: "job1",
      clinicId: "c1",
      patientId: "p1",
      status: "APPROVED",
      mode: "ANONYMIZE",
      scheduledFor: new Date(Date.now() - 60_000),
    };
    state.patient = { ...CARD };
    state.log = [
      {
        id: "a1",
        clinicId: "c1",
        action: "patient.create",
        entityType: "Patient",
        entityId: "p1",
        meta: { after: { ...CARD, birthDate: "1969-01-01T00:00:00.000Z" } },
      },
      {
        id: "a2",
        clinicId: "c1",
        action: "patient.update",
        entityType: "Patient",
        entityId: "p1",
        meta: { before: { phone: "+998 90 000-00-00" }, after: { phone: CARD.phone } },
      },
      {
        id: "a3",
        clinicId: "c1",
        action: "medical_case.create",
        entityType: "MedicalCase",
        entityId: "case1",
        meta: { after: { title: "Мигрень", patient: { id: "p1", fullName: CARD.fullName, phone: CARD.phone } } },
      },
      {
        id: "a4",
        clinicId: "c1",
        action: "patient.telegram.contact_linked",
        entityType: "Patient",
        entityId: "p1",
        meta: { telegramId: "555001", phone: CARD.phoneNormalized },
      },
      {
        id: "other-clinic",
        clinicId: "c2",
        action: "patient.create",
        entityType: "Patient",
        entityId: "p9",
        meta: { after: { fullName: "Турматов Отабек" } },
      },
    ];

    const { executeDeletionJob } = await import("@/server/workers/data-deletion");
    await executeDeletionJob("job1");

    expect(state.jobUpdates).toEqual([expect.objectContaining({ status: "ANONYMIZED" })]);
    const clinicLog = JSON.stringify(state.log.filter((r) => r.clinicId === "c1").map((r) => r.meta));
    for (const v of ["Турматов", "Отабек", "123-45-67", "+998901234567", "AB7654321", "555001", "otabek_t", "Чиланзар"]) {
      expect(clinicLog).not.toContain(v);
    }
    const dsarRow = state.log.find((r) => r.action === "PATIENT_ANONYMIZED")!;
    expect(dsarRow.meta).toEqual({
      jobId: "job1",
      erased: ["fullName", "phone", "phoneNormalized", "telegramId", "telegramUsername", "passport"],
    });
    // Another clinic's log is not touched.
    expect(state.log.find((r) => r.id === "other-clinic")!.meta).toEqual({
      after: { fullName: "Турматов Отабек" },
    });
  });
});

describe("scripts/fix-sec09-audit-pii", () => {
  it("rewrites old-shape rows into the new shape, and leaves new-shape rows alone", async () => {
    const { rewriteAuditMeta, dsarSnapshotIdentity } = await import(
      "../../scripts/fix-sec09-audit-pii"
    );
    const update = rewriteAuditMeta("patient.update", {
      before: { passport: "AB1", segment: "NEW" },
      after: { passport: "AB2", segment: "VIP" },
    });
    expect(update).toEqual({
      changed: ["passport", "segment"],
      before: { segment: "NEW" },
      after: { segment: "VIP" },
    });
    expect(rewriteAuditMeta("patient.update", update)).toBeNull();

    const created = rewriteAuditMeta("patient.create", { after: { ...CARD } });
    expect(JSON.stringify(created)).not.toContain("AB7654321");
    expect(rewriteAuditMeta("patient.create", created)).toBeNull();

    const caseRow = rewriteAuditMeta("medical_case.update", {
      before: { soapDraft: "S: a" },
      after: { soapDraft: "S: b", patient: { fullName: "X Y" } },
    });
    expect(caseRow).toEqual({ changed: ["soapDraft"], before: {}, after: {} });

    expect(
      dsarSnapshotIdentity("p1", { jobId: "j", before: { fullName: "Иван Иванов", phone: "+998" } }),
    ).toMatchObject({ id: "p1", fullName: "Иван Иванов" });
    expect(dsarSnapshotIdentity("p1", { jobId: "j", erased: ["fullName"] })).toBeNull();
  });
});
