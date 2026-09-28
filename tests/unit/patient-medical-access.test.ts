/**
 * Audit PT-11: medical data by role.
 *
 * Hiding the «Медицина» tab from the front desk and the call center was
 * cosmetic: the API served them diagnoses and chronic conditions, the case
 * PATCH let reception rewrite the diagnosis and the SOAP draft, the patient
 * list handed every role the decrypted passport and notes of up to 200
 * cards a page, and «Медицина → Заметки» was the same column as the
 * overview «Заметки» reception edits every day.
 *
 * Acceptance: as CALL_OPERATOR, GET .../diagnoses and PATCH a case's
 * diagnosisText answer 403; /api/crm/patients carries no passport / notes;
 * reception editing «Заметки» leaves the doctor's clinical note unchanged.
 * And every reception screen still loads: the case page (without its
 * clinical side), the allergies safety flag, the card itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isEncryptedField } from "@/server/crypto/field-cipher";

const state = vi.hoisted(() => ({
  role: "RECEPTIONIST",
  clinicalNote: null as null | { body: string; updatedById: string | null; updatedAt: Date },
  patientUpdates: [] as Array<Record<string, unknown>>,
  caseUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: "u-doc", role: state.role });
  // The real wrapper's role gate (`checkRoles`).
  const denied = (roles?: string[]) =>
    roles && !roles.includes(state.role)
      ? Response.json({ error: "Forbidden" }, { status: 403 })
      : null;
  return {
    createApiHandler:
      (
        opts: { roles?: string[]; bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        denied(opts.roles) ??
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx: ctx(),
        }),
    createApiListHandler:
      (opts: { roles?: string[] }, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        denied(opts.roles) ?? handler({ request, ctx: ctx() }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "e" })),
}));
vi.mock("@/server/patient/finance", () => ({
  loadCaseFinance: vi.fn(async () => ({ tracksPayments: false, paid: 0, visitsTotal: 0 })),
  loadPatientFinance: vi.fn(async () => ({ balance: 0 })),
  patientBalanceIdWhere: vi.fn(async () => null),
}));

const PATIENT = {
  id: "p1",
  clinicId: "c1",
  patientNumber: 1,
  fullName: "Каримова Дилноза",
  phone: "+998901112233",
  phoneNormalized: "+998901112233",
  phoneVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  birthDate: null,
  passport: "AA1234567",
  notes: "просит перезвонить после 18:00",
  summaryCache: "Мигрень, карбамазепин",
  summaryCacheUpdatedAt: new Date("2026-09-02T00:00:00Z"),
  segment: "NEW",
  tags: [],
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

const CASE = {
  id: "case1",
  clinicId: "c1",
  patientId: "p1",
  primaryDoctorId: "d1",
  title: "Головная боль",
  status: "OPEN",
  primaryComplaint: "Головная боль по утрам",
  diagnosisText: "Мигрень без ауры",
  diagnosisCode: "G43.0",
  notes: "контроль через месяц",
  soapDraft: "S: жалобы на головную боль",
  openedAt: new Date("2026-09-01T00:00:00Z"),
  closedAt: null,
  closedReason: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

vi.mock("@/lib/prisma", () => {
  const patient = {
    findUnique: vi.fn(async () => ({ ...PATIENT, appointments: [] })),
    findMany: vi.fn(async () => [{ ...PATIENT }]),
    count: vi.fn(async () => 1),
    groupBy: vi.fn(async () => [{ segment: "NEW", _count: { _all: 1 } }]),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.patientUpdates.push(data);
      return { ...PATIENT, ...data };
    }),
  };
  const rows = { findMany: vi.fn(async () => [{ id: "r1", patientId: "p1" }]) };
  const caseWithIncludes = () => ({
    ...CASE,
    primaryDoctor: null,
    patient: { id: "p1", fullName: PATIENT.fullName, phone: PATIENT.phone },
    appointments: [],
    prescriptions: [
      { id: "rx1", drugName: "Карбамазепин", dosage: "200 мг", schedule: {}, notes: null, status: "ACTIVE", remindersEnabled: true, doctorId: "d1", createdAt: new Date(), updatedAt: new Date(), doctor: null },
    ],
    _count: { appointments: 0 },
  });
  const medicalCase = {
    findUnique: vi.fn(async () => caseWithIncludes()),
    findMany: vi.fn(async () => [caseWithIncludes()]),
    count: vi.fn(async () => 1),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.caseUpdates.push(data);
      return { ...caseWithIncludes(), ...data };
    }),
  };
  const patientClinicalNote = {
    findUnique: vi.fn(async () => state.clinicalNote),
    upsert: vi.fn(
      async ({ create, update }: { create: { body: string; updatedById: string | null }; update: { body: string; updatedById: string | null } }) => {
        const next = state.clinicalNote ? update : create;
        state.clinicalNote = { body: next.body, updatedById: next.updatedById, updatedAt: new Date() };
        return state.clinicalNote;
      },
    ),
    deleteMany: vi.fn(async () => {
      state.clinicalNote = null;
      return { count: 1 };
    }),
  };
  const tx = { patient, medicalCase, prescription: { findMany: vi.fn(async () => []), updateMany: vi.fn() } };
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      patientDiagnosis: rows,
      patientChronicCondition: rows,
      patientAllergy: rows,
      patientClinicalNote,
      user: { findUnique: vi.fn(async () => ({ id: "u-doc", name: "Султанов Азиз" })) },
      doctor: { findUnique: vi.fn(async () => ({ id: "d1" })) },
    },
  };
});

const get = (url: string) => new Request(`https://x${url}`);
const send = (url: string, method: string, body: unknown) =>
  new Request(`https://x${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.role = "RECEPTIONIST";
  state.clinicalNote = {
    body: "План: карбамазепин 200 мг, контроль ЭЭГ",
    updatedById: "u-doc",
    updatedAt: new Date("2026-09-10T00:00:00Z"),
  };
  state.patientUpdates = [];
  state.caseUpdates = [];
});

describe("diagnoses and chronic conditions: clinical roles only", () => {
  it("call operator and reception get 403; the doctor and the nurse read them", async () => {
    const dx = await import("@/app/api/crm/patients/[id]/diagnoses/route");
    const chronic = await import("@/app/api/crm/patients/[id]/chronic-conditions/route");
    for (const role of ["CALL_OPERATOR", "RECEPTIONIST"]) {
      state.role = role;
      expect((await dx.GET(get("/api/crm/patients/p1/diagnoses"))).status).toBe(403);
      expect((await chronic.GET(get("/api/crm/patients/p1/chronic-conditions"))).status).toBe(403);
    }
    for (const role of ["DOCTOR", "NURSE", "ADMIN"]) {
      state.role = role;
      expect((await dx.GET(get("/api/crm/patients/p1/diagnoses"))).status).toBe(200);
      expect((await chronic.GET(get("/api/crm/patients/p1/chronic-conditions"))).status).toBe(200);
    }
  });

  it("allergies stay readable by the front desk and the call center: a safety flag", async () => {
    const allergies = await import("@/app/api/crm/patients/[id]/allergies/route");
    for (const role of ["CALL_OPERATOR", "RECEPTIONIST"]) {
      state.role = role;
      expect((await allergies.GET(get("/api/crm/patients/p1/allergies"))).status).toBe(200);
    }
  });
});

describe("medical cases", () => {
  it("PATCH diagnosisText: 403 for the call operator and for reception", async () => {
    const { PATCH } = await import("@/app/api/crm/cases/[id]/route");
    state.role = "CALL_OPERATOR";
    expect((await PATCH(send("/api/crm/cases/case1", "PATCH", { diagnosisText: "X" }))).status).toBe(403);
    state.role = "RECEPTIONIST";
    const res = await PATCH(send("/api/crm/cases/case1", "PATCH", { diagnosisText: "X" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      reason: "clinical_fields_forbidden",
      fields: ["diagnosisText"],
    });
    for (const body of [{ soapDraft: "S:" }, { diagnosisCode: "G40" }]) {
      expect((await PATCH(send("/api/crm/cases/case1", "PATCH", body))).status).toBe(403);
    }
    expect(state.caseUpdates).toEqual([]);
  });

  it("reception still renames a case and changes its doctor; the doctor writes the diagnosis", async () => {
    const { PATCH } = await import("@/app/api/crm/cases/[id]/route");
    const res = await PATCH(send("/api/crm/cases/case1", "PATCH", { title: "Мигрень", primaryDoctorId: "d1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Мигрень");
    expect(body).not.toHaveProperty("diagnosisText");
    state.role = "DOCTOR";
    expect((await PATCH(send("/api/crm/cases/case1", "PATCH", { diagnosisText: "Мигрень с аурой" }))).status).toBe(200);
    expect(state.caseUpdates.at(-1)).toMatchObject({ diagnosisText: "Мигрень с аурой" });
  });

  it("reception opening a case at booking cannot set a diagnosis", async () => {
    const { POST } = await import("@/app/api/crm/cases/route");
    const res = await POST(
      send("/api/crm/cases", "POST", { patientId: "p1", title: "Боль", diagnosisText: "Мигрень" }),
    );
    expect(res.status).toBe(403);
  });

  it("the case page still loads for reception and the call center, without its clinical side", async () => {
    const { GET } = await import("@/app/api/crm/cases/[id]/route");
    for (const role of ["RECEPTIONIST", "CALL_OPERATOR"]) {
      state.role = role;
      const res = await GET(get("/api/crm/cases/case1"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe("Головная боль");
      expect(body.primaryComplaint).toBe("Головная боль по утрам");
      expect(body.runningPrescriptions).toBe(1);
      for (const k of ["diagnosisText", "diagnosisCode", "soapDraft", "prescriptions"]) {
        expect(body).not.toHaveProperty(k);
      }
    }
    state.role = "DOCTOR";
    const body = await (await GET(get("/api/crm/cases/case1"))).json();
    expect(body.diagnosisText).toBe("Мигрень без ауры");
    expect(body.prescriptions).toHaveLength(1);
  });

  it("the case list: no SOAP draft for anyone, no diagnosis for reception", async () => {
    const { GET } = await import("@/app/api/crm/cases/route");
    const recep = await (await GET(get("/api/crm/cases?patientId=p1"))).json();
    expect(recep.rows[0]).not.toHaveProperty("diagnosisText");
    expect(recep.rows[0]).not.toHaveProperty("soapDraft");
    expect(recep.rows[0].title).toBe("Головная боль");
    state.role = "DOCTOR";
    const doc = await (await GET(get("/api/crm/cases?patientId=p1"))).json();
    expect(doc.rows[0].diagnosisText).toBe("Мигрень без ауры");
    expect(doc.rows[0]).not.toHaveProperty("soapDraft");
  });
});

describe("the patient list", () => {
  it("carries no passport, notes or AI summary, for any role", async () => {
    const { GET } = await import("@/app/api/crm/patients/route");
    for (const role of ["CALL_OPERATOR", "RECEPTIONIST", "DOCTOR"]) {
      state.role = role;
      const res = await GET(get("/api/crm/patients?limit=200"));
      expect(res.status).toBe(200);
      const { rows } = await res.json();
      expect(rows[0].fullName).toBe("Каримова Дилноза");
      for (const k of ["passport", "notes", "summaryCache", "summaryCacheUpdatedAt"]) {
        expect(rows[0]).not.toHaveProperty(k);
      }
    }
  });
});

describe("the clinical note is not the staff note", () => {
  it("reception editing «Заметки» on the overview leaves the doctor's note as it was", async () => {
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    const res = await PATCH(send("/api/crm/patients/p1", "PATCH", { notes: "перезвонить после 18:00" }));
    expect(res.status).toBe(200);
    expect(state.patientUpdates).toHaveLength(1);
    expect(state.clinicalNote?.body).toBe("План: карбамазепин 200 мг, контроль ЭЭГ");
  });

  it("reception and the call center cannot read or write it", async () => {
    const note = await import("@/app/api/crm/patients/[id]/clinical-note/route");
    for (const role of ["RECEPTIONIST", "CALL_OPERATOR"]) {
      state.role = role;
      expect((await note.GET(get("/api/crm/patients/p1/clinical-note"))).status).toBe(403);
      expect(
        (await note.PUT(send("/api/crm/patients/p1/clinical-note", "PUT", { text: "x" }))).status,
      ).toBe(403);
    }
  });

  it("the doctor saves it encrypted, with who and when", async () => {
    state.role = "DOCTOR";
    state.clinicalNote = null;
    const note = await import("@/app/api/crm/patients/[id]/clinical-note/route");
    const res = await note.PUT(
      send("/api/crm/patients/p1/clinical-note", "PUT", { text: "  Жалобы на головную боль  " }),
    );
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.text).toBe("Жалобы на головную боль");
    expect(saved.updatedBy).toEqual({ id: "u-doc", name: "Султанов Азиз" });
    expect(isEncryptedField(state.clinicalNote!.body)).toBe(true);
    const read = await (await note.GET(get("/api/crm/patients/p1/clinical-note"))).json();
    expect(read.text).toBe("Жалобы на головную боль");
    // An empty save removes the note.
    await note.PUT(send("/api/crm/patients/p1/clinical-note", "PUT", { text: " " }));
    expect(state.clinicalNote).toBeNull();
  });
});
