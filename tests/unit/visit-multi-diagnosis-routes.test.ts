/**
 * Clinic request 29.09.2026: one main diagnosis and up to three more per
 * visit. The routes that write them.
 *
 * Pinned (acceptance), driving the real PATCH and finalize handlers against
 * an in-memory note, revision table and patient card:
 *   1. PATCH takes the list and stores it settled: trimmed, no duplicate of
 *      the main one, the main one picked among the others leaves them, a
 *      cleared main one hands its place to the first other. A fourth is
 *      refused; a text-only save leaves the diagnoses alone.
 *   2. A diagnosis the doctor adds joins the clinic's list the way the main
 *      one does (learn path, not counted as a use until signed).
 *   3. A signed note corrected in the window: the handout names the new
 *      diagnosis, the EDITED revision names the field, and the card gets it.
 *   4. Finalize puts every diagnosis on the card, learns each, writes them
 *      into the handout (names only) and into the SIGNED revision.
 *   5. A single-diagnosis note signs exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  learn: [] as Array<Record<string, unknown>>,
}));

const state = {
  note: null as Row | null,
  revisions: [] as Row[],
  noteUpdates: [] as Row[],
  audits: [] as Array<{ action: string; meta: Row }>,
  card: [] as Row[],
};

const TENSION = { code: "G44.2", name: "Головная боль напряжённого типа" };
const CERVICALGIA = { code: "M54.2", name: "Цервикалгия" };

function note(over: Row = {}): Row {
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "DRAFT",
    finalizedAt: null,
    firstFinalizedAt: null,
    documentNumber: null,
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень без ауры",
    additionalDiagnoses: [],
    complaints: ["Головная боль"],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: ["Режим сна"],
    followUpDays: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение врача.",
    patientHandoutMarkdown: null,
    handoutStaleAt: null,
    medicationsBridgedAt: null,
    updatedAt: new Date(Date.now() - HOUR),
    patient: { fullName: "Рахимов Сардор" },
    doctor: { nameRu: "Султанов Азиз", specializationRu: "Невролог" },
    clinic: { nameRu: "NeuroFax" },
    appointment: {
      id: "apt_1",
      date: new Date(Date.now() - 2 * HOUR),
      status: "IN_PROGRESS",
      completedAt: null,
      endDate: new Date(Date.now() + HOUR),
      queueStatus: "IN_PROGRESS",
      doctorId: "doc_1",
      patientId: "p1",
      cabinetId: null,
    },
    ...over,
  };
}

function signed(over: Row = {}): Row {
  const at = new Date(Date.now() - 2 * HOUR);
  return note({
    status: "FINALIZED",
    finalizedAt: at,
    firstFinalizedAt: at,
    documentNumber: "NF-2026-000042",
    patientHandoutMarkdown: "# Памятка для пациента\n\n**Диагноз:** Мигрень без ауры\n",
    appointment: { ...(note().appointment as Row), status: "COMPLETED", completedAt: at },
    ...over,
  });
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, e: { action: string; meta: Row }) => {
    state.audits.push({ action: e.action, meta: e.meta });
  }),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/icd10/clinic-catalog", () => ({
  learnClinicDiagnosis: vi.fn(async (args: Record<string, unknown>) => {
    h.learn.push(args);
  }),
}));
vi.mock("@/server/services/document-number", () => ({
  allocateDocumentNumber: vi.fn(async () => "NF-2026-000099"),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
vi.mock("@/server/appointments/completion-effects", () => ({
  runCompletionEffects: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => {
  const full = () => ({ ...state.note, visitPrescriptions: [] });
  const prisma = {
    visitNote: {
      findUnique: vi.fn(async () => (state.note ? full() : null)),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.noteUpdates.push(data);
        state.note = { ...state.note, ...data, updatedAt: new Date() };
        return full();
      }),
      // No other signed note carries anything.
      count: vi.fn(async () => 0),
      // The conditional claim of the draft (VW-19): this note is a draft.
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    visitPrescription: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    visitNoteRevision: {
      findFirst: vi.fn(async () => state.revisions.at(-1) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.revisions.push(data);
        return { id: `rev_${data.revision}`, revision: data.revision };
      }),
    },
    document: { findUnique: vi.fn(async () => null) },
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", nameRu: "Султанов Азиз" })),
    },
    appointment: {
      update: vi.fn(async ({ data }: { data: Row }) => ({
        ...(state.note?.appointment as Row),
        ...data,
      })),
    },
    patientDiagnosis: {
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        state.card.filter((r) => r.sourceVisitNoteId === where.sourceVisitNoteId),
      ),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const r = state.card.find((x) =>
          where.icd10Code
            ? x.icd10Code === where.icd10Code
            : !x.icd10Code && x.label === where.label,
        );
        return r ? { id: r.id } : null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `pd_${state.card.length + 1}`, notes: null, ...data };
        state.card.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = state.card.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { id: row.id };
      }),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

// ----- helpers -------------------------------------------------------------

async function patch(body: Row): Promise<Response> {
  vi.resetModules();
  const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
  return PATCH(
    new Request("https://x/api/crm/visit-notes/vn_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function finalize(): Promise<Response> {
  vi.resetModules();
  const { POST } = await import("@/app/api/crm/visit-notes/[id]/finalize/route");
  return POST(
    new Request("https://x/api/crm/visit-notes/vn_1/finalize", { method: "POST" }),
  );
}

/** Let the fire-and-forget learn calls land. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const activeCodes = () =>
  state.card
    .filter((r) => r.status === "ACTIVE")
    .map((r) => (r.icd10Code as string | null) ?? (r.label as string))
    .sort();

beforeEach(() => {
  state.note = note();
  state.revisions = [];
  state.noteUpdates = [];
  state.audits = [];
  state.card = [];
  h.learn = [];
});

// ----- PATCH ---------------------------------------------------------------

describe("PATCH stores the set settled", () => {
  it("takes the others trimmed, without a duplicate of the main one", async () => {
    const res = await patch({
      additionalDiagnoses: [
        { code: "g43.0", name: "Мигрень" },
        { code: " G44.2 ", name: " Головная боль напряжённого типа " },
        { code: null, name: "Последствия ЧМТ" },
      ],
    });
    expect(res.status).toBe(200);
    const data = state.noteUpdates[0]!;
    expect(data.additionalDiagnoses).toEqual([
      TENSION,
      { code: null, name: "Последствия ЧМТ" },
    ]);
    // The main one was not sent and did not move: not rewritten.
    expect("diagnosisCode" in data).toBe(false);
    expect("diagnosisName" in data).toBe(false);
    // The response carries the settled list for the editor.
    expect(((await res.json()) as Row).additionalDiagnoses).toEqual(
      data.additionalDiagnoses,
    );
  });

  it("the main one picked among the others leaves them", async () => {
    state.note = note({ additionalDiagnoses: [TENSION, CERVICALGIA] });
    await patch({ diagnosisCode: TENSION.code, diagnosisName: TENSION.name });
    const data = state.noteUpdates[0]!;
    expect(data).toMatchObject({
      diagnosisCode: "G44.2",
      diagnosisName: TENSION.name,
      additionalDiagnoses: [CERVICALGIA],
    });
  });

  it("a cleared main one hands its place to the first of the others", async () => {
    state.note = note({ additionalDiagnoses: [TENSION, CERVICALGIA] });
    await patch({ diagnosisCode: null, diagnosisName: null });
    expect(state.noteUpdates[0]).toMatchObject({
      diagnosisCode: "G44.2",
      diagnosisName: TENSION.name,
      additionalDiagnoses: [CERVICALGIA],
    });
  });

  it("refuses a fourth", async () => {
    const res = await patch({
      additionalDiagnoses: [
        TENSION,
        CERVICALGIA,
        { code: null, name: "Последствия ЧМТ" },
        { code: "R51", name: "Головная боль" },
      ],
    });
    expect(res.status).toBe(400);
    expect(state.noteUpdates).toHaveLength(0);
  });

  it("a text-only save leaves the diagnoses alone", async () => {
    state.note = note({ additionalDiagnoses: [TENSION] });
    await patch({ bodyMarkdown: "Исправленный текст." });
    const data = state.noteUpdates[0]!;
    expect("additionalDiagnoses" in data).toBe(false);
    expect("diagnosisCode" in data).toBe(false);
  });

  it("a diagnosis the doctor adds joins the clinic's list, not counted yet", async () => {
    state.note = note({ additionalDiagnoses: [TENSION] });
    await patch({
      additionalDiagnoses: [TENSION, { code: null, name: "Последствия ЧМТ" }],
    });
    await settle();
    // Only the new one: G44.2 was already on the note, the main one did not change.
    expect(h.learn).toEqual([
      expect.objectContaining({ code: null, nameRu: "Последствия ЧМТ", countUse: false }),
    ]);
  });
});

describe("PATCH of a signed note inside the window", () => {
  it("an added diagnosis reaches the handout, the revision and the card", async () => {
    state.note = signed();
    state.card = [
      {
        id: "pd_1",
        icd10Code: "G43.0",
        label: "Мигрень без ауры",
        status: "ACTIVE",
        notes: null,
        sourceVisitNoteId: "vn_1",
      },
    ];

    const res = await patch({ additionalDiagnoses: [TENSION] });

    expect(res.status).toBe(200);
    const data = state.noteUpdates[0]!;
    expect(data.patientHandoutMarkdown).toContain(
      "**Сопутствующие диагнозы:** Головная боль напряжённого типа",
    );
    expect(data.handoutStaleAt).toBeInstanceOf(Date);

    const edited = state.revisions.find((r) => r.kind === "EDITED")!;
    expect(edited.changedFields).toEqual(
      expect.arrayContaining(["additionalDiagnoses", "patientHandoutMarkdown"]),
    );
    expect((edited.content as Row).additionalDiagnoses).toEqual([TENSION]);
    // The state it replaced had none, and says so by leaving the key out.
    const before = state.revisions.find((r) => r.kind === "PRE_EDIT")!;
    expect("additionalDiagnoses" in (before.content as Row)).toBe(false);

    expect(activeCodes()).toEqual(["G43.0", "G44.2"]);
    expect(state.card.find((r) => r.icd10Code === "G44.2")!.sourceVisitNoteId).toBe(
      "vn_1",
    );
  });

  it("a removed one is resolved on the card", async () => {
    state.note = signed({ additionalDiagnoses: [TENSION] });
    state.card = [
      { id: "pd_1", icd10Code: "G43.0", label: "Мигрень без ауры", status: "ACTIVE", notes: null, sourceVisitNoteId: "vn_1" },
      { id: "pd_2", icd10Code: "G44.2", label: TENSION.name, status: "ACTIVE", notes: null, sourceVisitNoteId: "vn_1" },
    ];
    await patch({ additionalDiagnoses: [] });
    expect(activeCodes()).toEqual(["G43.0"]);
    expect(state.card.find((r) => r.id === "pd_2")!.status).toBe("RESOLVED");
  });
});

// ----- finalize ------------------------------------------------------------

describe("finalize signs every diagnosis", () => {
  it("card, clinic list, handout and signed revision all get them", async () => {
    state.note = note({
      additionalDiagnoses: [TENSION, { code: null, name: "Последствия ЧМТ" }],
    });

    const res = await finalize();
    await settle();

    expect(res.status).toBe(200);
    expect(activeCodes()).toEqual(["G43.0", "G44.2", "Последствия ЧМТ"]);

    const handout = state.noteUpdates[0]!.patientHandoutMarkdown as string;
    expect(handout).toContain("**Диагноз:** Мигрень без ауры");
    expect(handout).toContain(
      "**Сопутствующие диагнозы:** Головная боль напряжённого типа; Последствия ЧМТ",
    );
    expect(handout).not.toContain("G44.2");

    const signedRev = state.revisions.find((r) => r.kind === "SIGNED")!;
    expect((signedRev.content as Row).additionalDiagnoses).toEqual([
      TENSION,
      { code: null, name: "Последствия ЧМТ" },
    ]);

    // Signed uses count: no countUse:false on any of them.
    expect(h.learn.map((l) => l.nameRu)).toEqual([
      "Мигрень без ауры",
      TENSION.name,
      "Последствия ЧМТ",
    ]);
    expect(h.learn.every((l) => l.countUse === undefined)).toBe(true);

    const audit = state.audits.find((a) => a.action === "visit_note.finalize")!;
    expect(audit.meta.patientDiagnosisIds).toHaveLength(3);
  });

  it("a single-diagnosis note signs exactly as before", async () => {
    const res = await finalize();
    await settle();

    expect(res.status).toBe(200);
    expect(activeCodes()).toEqual(["G43.0"]);
    const handout = state.noteUpdates[0]!.patientHandoutMarkdown as string;
    expect(handout).not.toContain("Сопутствующие");
    const signedRev = state.revisions.find((r) => r.kind === "SIGNED")!;
    expect("additionalDiagnoses" in (signedRev.content as Row)).toBe(false);
    const audit = state.audits.find((a) => a.action === "visit_note.finalize")!;
    expect("patientDiagnosisIds" in audit.meta).toBe(false);
    expect(h.learn).toHaveLength(1);
  });
});
