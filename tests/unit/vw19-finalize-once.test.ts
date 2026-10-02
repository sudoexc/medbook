/**
 * Audit VW-19 — two finalize POSTs at once (a double click on slow Wi-Fi,
 * the reception tab and «Мой день», a network retry) both passed the
 * FINALIZED guard, read outside the transaction. The second one allocated a
 * fresh number over the first one's (burning it, and changing the number
 * after a PDF may already have been printed) and replayed the visit's
 * events and diagnosis sync.
 *
 * Pinned: the transaction claims the draft with a conditional write first.
 * Of two concurrent signatures one signs, the other answers
 * `alreadyFinalized` with the first one's number; one number is allocated,
 * one revision and one statusChanged event are written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  refreshStats: vi.fn(async () => undefined),
  allocate: vi.fn(),
  emit: vi.fn(async () => ({ eventId: "ev_1" })),
}));

const state = {
  note: null as Row | null,
  reads: 0,
  txChain: Promise.resolve() as Promise<unknown>,
  openGate: () => {},
  gate: Promise.resolve() as Promise<void>,
  revisions: [] as Row[],
  counter: 0,
};

function draftNote(): Row {
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
    advice: [],
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение.",
    patientHandoutMarkdown: null,
    updatedAt: new Date(),
    patient: { fullName: "Рахимов Сардор", preferredLang: "RU" },
    doctor: { nameRu: "Султанов А.", specializationRu: "Невролог" },
    clinic: { nameRu: "NeuroFax" },
    visitPrescriptions: [],
    appointment: {
      id: "apt_1",
      status: "IN_PROGRESS",
      date: new Date(Date.now() - 60 * 60_000),
      endDate: new Date(Date.now() - 30 * 60_000),
      completedAt: null,
      queueStatus: "IN_PROGRESS",
      doctorId: "doc_1",
      patientId: "p1",
      cabinetId: null,
    },
  };
}

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
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/icd10/clinic-catalog", () => ({
  learnClinicDiagnosis: vi.fn(async () => undefined),
}));
vi.mock("@/server/services/document-number", () => ({
  allocateDocumentNumber: h.allocate,
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: h.emit,
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
  refreshPatientVisitStats: h.refreshStats,
}));
vi.mock("@/server/notifications/triggers", () => ({
  fireTrigger: h.fireTrigger,
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    visitNote: {
      findUnique: vi.fn(async () => {
        state.reads += 1;
        // Both requests have read the draft: let the transactions run.
        if (state.reads >= 2) state.openGate();
        return state.note ? { ...state.note } : null;
      }),
      // The claim: matches only while the row is still a draft.
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        if (!state.note || state.note.status !== where.status) return { count: 0 };
        state.note = { ...state.note, ...data };
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.note = { ...state.note, ...data };
        return { ...state.note };
      }),
    },
    visitNoteRevision: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.revisions.push(data);
        return { id: `rev_${data.revision}`, revision: data.revision };
      }),
    },
    document: { findUnique: vi.fn(async () => null) },
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", nameRu: "Султанов А." })),
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
    // One transaction at a time, as the claim's row lock serialises them;
    // none before both requests passed the guard outside it.
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
      await state.gate;
      const run = state.txChain.then(() => fn(prisma));
      state.txChain = run.catch(() => undefined);
      return run;
    }),
  };
  return { prisma };
});

beforeEach(() => {
  state.note = draftNote();
  state.reads = 0;
  state.txChain = Promise.resolve();
  state.gate = new Promise<void>((r) => (state.openGate = r));
  state.revisions = [];
  state.counter = 0;
  h.allocate.mockReset();
  h.allocate.mockImplementation(async () => {
    state.counter += 1;
    return `NF-2026-${String(122 + state.counter).padStart(6, "0")}`;
  });
  h.emit.mockClear();
  h.fireTrigger.mockClear();
});

describe("VW-19: a note is signed once, whatever the number of POSTs", () => {
  it("two concurrent signatures: one signs, the other is alreadyFinalized", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/crm/visit-notes/[id]/finalize/route");
    const post = () =>
      POST(
        new Request("https://x/api/crm/visit-notes/vn_1/finalize", {
          method: "POST",
        }),
      );
    const responses = await Promise.all([post(), post()]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
      note: Row;
      alreadyFinalized?: boolean;
    }>;

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(bodies.filter((b) => b.alreadyFinalized)).toHaveLength(1);
    // One number, kept: both answers carry it.
    expect(h.allocate).toHaveBeenCalledTimes(1);
    expect(bodies.map((b) => b.note.documentNumber)).toEqual([
      "NF-2026-000123",
      "NF-2026-000123",
    ]);
    expect(state.note?.documentNumber).toBe("NF-2026-000123");
    // The signature's side effects happened once.
    expect(state.revisions).toHaveLength(1);
    expect(h.emit).toHaveBeenCalledTimes(1);
  });

  it("a re-signature after a revert keeps the number it was issued", async () => {
    state.note = { ...draftNote(), documentNumber: "NF-2026-000050" };
    state.openGate();
    vi.resetModules();
    const { POST } = await import("@/app/api/crm/visit-notes/[id]/finalize/route");
    const res = await POST(
      new Request("https://x/api/crm/visit-notes/vn_1/finalize", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(h.allocate).not.toHaveBeenCalled();
    expect(state.note?.documentNumber).toBe("NF-2026-000050");
  });
});
