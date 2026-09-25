/**
 * Audits VW-02 and G1-01: what happens to a SIGNED conclusion when it is
 * corrected inside the 24h window, or reopened and signed again.
 *
 * VW-02 — the patient handout was composed once, at the first signature. A
 * dose corrected on the conclusion screen reached the PDF only in the
 * schedule grid, under a text still naming the old dose, and the Mini App
 * kept the old text entirely; a drug removed after a revert stayed in the
 * re-signed handout. Now every correction and every signature recomposes it.
 *
 * G1-01 — the correction overwrote the signed note in place and nothing kept
 * the original. Now each signed state is an immutable revision: SIGNED at a
 * signature, EDITED after a correction (with its author and changed fields),
 * PRE_EDIT for a state no revision held yet.
 *
 * Strategy: drive the real PATCH and finalize handlers against an in-memory
 * note, prescription rows and revision table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  changedRevisionFields,
  revisionContentOf,
  sameRevisionContent,
} from "@/server/visit-notes/revisions";

type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;

const state = {
  note: null as Row | null,
  rows: [] as Row[],
  revisions: [] as Row[],
  noteUpdates: [] as Row[],
  audits: [] as Array<{ action: string; meta: Row }>,
};

function rx(over: Row = {}): Row {
  return {
    drugId: "drug_concor",
    displayName: "Конкор",
    form: "таб.",
    strength: "5 мг",
    dose: "5 мг",
    timesOfDay: ["MORNING"],
    mealRelation: "NO_MATTER",
    durationDays: 30,
    instructionRu: null,
    instructionUz: null,
    remindPatient: true,
    ...over,
  };
}

function signedNote(over: Row = {}): Row {
  const signedAt = new Date(Date.now() - 2 * HOUR);
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "FINALIZED",
    finalizedAt: signedAt,
    firstFinalizedAt: signedAt,
    documentNumber: "NF-2026-000042",
    diagnosisCode: "I10",
    diagnosisName: "Эссенциальная гипертензия",
    complaints: ["Головная боль"],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: ["Ограничить соль"],
    followUpDays: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение врача.",
    patientHandoutMarkdown:
      "# Памятка для пациента\n\n**Диагноз:** Эссенциальная гипертензия\n\n- Конкор 5 мг, утром",
    handoutStaleAt: null,
    medicationsBridgedAt: signedAt,
    updatedAt: new Date(Date.now() - HOUR),
    patient: { fullName: "Рахимов Сардор" },
    doctor: { nameRu: "Юсупова Д.Р.", specializationRu: "Невролог" },
    clinic: { nameRu: "NeuroFax" },
    appointment: {
      id: "apt_1",
      date: new Date(Date.now() - 3 * HOUR),
      status: "COMPLETED",
      completedAt: signedAt,
      endDate: new Date(Date.now() - 2 * HOUR),
      queueStatus: "COMPLETED",
      doctorId: "doc_1",
      patientId: "p1",
      cabinetId: null,
    },
    ...over,
  };
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
  learnClinicDiagnosis: vi.fn(async () => undefined),
}));
vi.mock("@/server/services/document-number", () => ({
  allocateDocumentNumber: vi.fn(async () => "NF-2026-000099"),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
  refreshPatientVisitStats: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const withRows = () => ({
    ...state.note,
    visitPrescriptions: state.rows.map((r, i) => ({
      id: `vp_${i}`,
      sortOrder: i,
      ...r,
    })),
  });
  const prisma = {
    visitNote: {
      findUnique: vi.fn(async () => (state.note ? withRows() : null)),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.noteUpdates.push(data);
        state.note = {
          ...state.note,
          ...data,
          updatedAt: new Date(),
        };
        return withRows();
      }),
    },
    visitPrescription: {
      findMany: vi.fn(async () =>
        state.rows.map((r, i) => ({ sortOrder: i, ...r })),
      ),
      deleteMany: vi.fn(async () => {
        state.rows = [];
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        state.rows = data.map(
          ({ visitNoteId: _n, sortOrder: _s, ...r }) => r,
        );
        return { count: data.length };
      }),
    },
    visitNoteRevision: {
      findFirst: vi.fn(async () =>
        state.revisions.length
          ? state.revisions[state.revisions.length - 1]
          : null,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.revisions.push(data);
        return { id: `rev_${data.revision}`, revision: data.revision };
      }),
    },
    document: {
      findUnique: vi.fn(async () => ({
        fileUrl:
          "https://neurofax.uz/files/medbook/clinics/c1/conclusions/vn_1.pdf",
      })),
    },
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", nameRu: "Юсупова Д.Р." })),
    },
    appointment: {
      update: vi.fn(async ({ data }: { data: Row }) => ({
        ...(state.note?.appointment as Row),
        ...data,
      })),
    },
    patientDiagnosis: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "pd_1" })),
      update: vi.fn(async () => ({ id: "pd_1" })),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn(prisma),
    ),
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
  const { POST } = await import(
    "@/app/api/crm/visit-notes/[id]/finalize/route"
  );
  return POST(
    new Request("https://x/api/crm/visit-notes/vn_1/finalize", {
      method: "POST",
    }),
  );
}

/** The revision a finalize of the current state would have written. */
function signedRevision(revision = 1): Row {
  return {
    revision,
    kind: "SIGNED",
    content: revisionContentOf(
      state.note as unknown as Parameters<typeof revisionContentOf>[0],
      state.rows as unknown as Parameters<typeof revisionContentOf>[1],
    ),
  };
}

beforeEach(() => {
  state.note = signedNote();
  state.rows = [rx()];
  state.revisions = [];
  state.noteUpdates = [];
  state.audits = [];
});

// ----- VW-02 ---------------------------------------------------------------

describe("VW-02: a correction inside the window recomposes the handout", () => {
  it("new dose and new diagnosis everywhere, no trace of the old ones", async () => {
    state.revisions = [signedRevision()];

    const res = await patch({
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
      visitPrescriptions: [rx({ dose: "10 мг", strength: "10 мг" })],
    });

    expect(res.status).toBe(200);
    const data = state.noteUpdates[0]!;
    const handout = data.patientHandoutMarkdown as string;
    expect(handout).toContain("Мигрень без ауры");
    expect(handout).toContain("10 мг");
    expect(handout).not.toContain("5 мг");
    expect(handout).not.toContain("гипертензия");
    // The PDF is re-rendered from it (and the Mini App reads it directly).
    expect(data.handoutStaleAt).toBeInstanceOf(Date);
  });

  it("a text-only correction leaves the handout alone", async () => {
    state.revisions = [signedRevision()];
    const res = await patch({ bodyMarkdown: "Исправленный текст заключения." });
    expect(res.status).toBe(200);
    expect(state.noteUpdates[0]!.patientHandoutMarkdown).toBeUndefined();
  });

  it("finalize after a revert recomposes it: a removed drug is gone", async () => {
    // Reverted (DRAFT, signed once), the doctor removed the drug; the old
    // handout still lists it.
    state.note = signedNote({ status: "DRAFT", finalizedAt: null });
    state.revisions = [signedRevision()];
    state.rows = [];

    const res = await finalize();

    expect(res.status).toBe(200);
    const handout = state.noteUpdates[0]!.patientHandoutMarkdown as string;
    expect(handout).not.toContain("Конкор");
    expect(handout).toContain("Эссенциальная гипертензия");
  });

  it("finalize composes the handout at the first signature too", async () => {
    state.note = signedNote({
      status: "DRAFT",
      finalizedAt: null,
      firstFinalizedAt: null,
      patientHandoutMarkdown: null,
    });

    await finalize();

    const handout = state.noteUpdates[0]!.patientHandoutMarkdown as string;
    expect(handout).toContain("Конкор");
    expect(handout).toContain("5 мг");
  });
});

// ----- G1-01 ---------------------------------------------------------------

describe("G1-01: every signed state stays on record", () => {
  it("the first signature writes an immutable SIGNED revision", async () => {
    state.note = signedNote({
      status: "DRAFT",
      finalizedAt: null,
      firstFinalizedAt: null,
    });

    await finalize();

    expect(state.revisions).toHaveLength(1);
    const r = state.revisions[0]!;
    expect(r).toMatchObject({
      revision: 1,
      kind: "SIGNED",
      authorUserId: "u_doc_1",
      authorName: "Юсупова Д.Р.",
      changedFields: [],
    });
    const content = r.content as { visitPrescriptions: Row[]; documentNumber: string };
    expect(content.visitPrescriptions[0]).toMatchObject({ dose: "5 мг" });
    expect(content.documentNumber).toBe("NF-2026-000042");
    const audit = state.audits.find((a) => a.action === "visit_note.finalize");
    expect(audit?.meta.revision).toBe(1);
  });

  it("an in-window correction appends EDITED with before/after, author and changed fields", async () => {
    state.revisions = [signedRevision()];

    await patch({
      diagnosisName: "Мигрень без ауры",
      visitPrescriptions: [rx({ dose: "10 мг" })],
    });

    // The signed original is untouched; the correction is a new row.
    expect(state.revisions).toHaveLength(2);
    const original = state.revisions[0]!.content as {
      diagnosisName: string;
      visitPrescriptions: Row[];
    };
    expect(original.diagnosisName).toBe("Эссенциальная гипертензия");
    expect(original.visitPrescriptions[0]).toMatchObject({ dose: "5 мг" });

    const edited = state.revisions[1]!;
    expect(edited).toMatchObject({
      revision: 2,
      kind: "EDITED",
      authorUserId: "u_doc_1",
      authorName: "Юсупова Д.Р.",
    });
    expect(edited.changedFields).toEqual(
      expect.arrayContaining([
        "diagnosisName",
        "visitPrescriptions",
        "patientHandoutMarkdown",
      ]),
    );
    const after = edited.content as { visitPrescriptions: Row[] };
    expect(after.visitPrescriptions[0]).toMatchObject({ dose: "10 мг" });

    // The audit entry points at both versions.
    const audit = state.audits.find((a) => a.action === "visit_note.update");
    expect(audit?.meta.revisions).toEqual({ before: 1, after: 2 });
  });

  it("a note signed before revisions existed gets its signed state kept first, with the issued PDF", async () => {
    await patch({ visitPrescriptions: [rx({ dose: "10 мг" })] });

    expect(state.revisions.map((r) => [r.revision, r.kind])).toEqual([
      [1, "PRE_EDIT"],
      [2, "EDITED"],
    ]);
    const kept = state.revisions[0]!;
    expect(kept.pdfObjectKey).toBe("clinics/c1/conclusions/vn_1.pdf");
    expect(
      (kept.content as { visitPrescriptions: Row[] }).visitPrescriptions[0],
    ).toMatchObject({ dose: "5 мг" });
  });

  it("a resend that changes nothing records nothing", async () => {
    state.revisions = [signedRevision()];
    await patch({ visitPrescriptions: [rx()] });
    expect(state.revisions).toHaveLength(1);
  });

  it("a re-signature after a revert notes what it changed", async () => {
    state.note = signedNote({ status: "DRAFT", finalizedAt: null });
    state.revisions = [signedRevision()];
    state.rows = [];

    await finalize();

    const resigned = state.revisions[1]!;
    expect(resigned).toMatchObject({ revision: 2, kind: "SIGNED" });
    expect(resigned.changedFields).toEqual(
      expect.arrayContaining(["visitPrescriptions", "patientHandoutMarkdown"]),
    );
  });

  it("a reopened draft keeps the signed state before its first edit, then stays quiet", async () => {
    state.note = signedNote({ status: "DRAFT", finalizedAt: null });

    await patch({ bodyMarkdown: "Правка после отката." });
    expect(state.revisions.map((r) => r.kind)).toEqual(["PRE_EDIT"]);
    expect(
      (state.revisions[0]!.content as { bodyMarkdown: string }).bodyMarkdown,
    ).toBe("Заключение врача.");

    await patch({ bodyMarkdown: "Ещё одна правка." });
    expect(state.revisions).toHaveLength(1);
  });

  it("a never-signed draft does not touch revisions", async () => {
    state.note = signedNote({
      status: "DRAFT",
      finalizedAt: null,
      firstFinalizedAt: null,
    });
    await patch({ bodyMarkdown: "Черновик." });
    expect(state.revisions).toHaveLength(0);
  });
});

describe("G1-01: revision content comparison", () => {
  it("ignores key order (jsonb reorders object keys)", () => {
    const a = revisionContentOf(
      signedNote() as unknown as Parameters<typeof revisionContentOf>[0],
      [rx()] as unknown as Parameters<typeof revisionContentOf>[1],
    );
    const shuffled = JSON.parse(
      JSON.stringify(
        Object.fromEntries(Object.entries(a).reverse()),
      ),
    ) as Record<string, unknown>;
    expect(sameRevisionContent(shuffled, a)).toBe(true);
  });

  it("names exactly the fields that differ", () => {
    const a = revisionContentOf(
      signedNote() as unknown as Parameters<typeof revisionContentOf>[0],
      [rx()] as unknown as Parameters<typeof revisionContentOf>[1],
    );
    const b = { ...a, followUpDays: 14 };
    expect(changedRevisionFields(a, b)).toEqual(["followUpDays"]);
  });
});
