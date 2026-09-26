/**
 * Audit VW-03: finalize closed a visit in any state, cancelled and no-show
 * included, bypassing the appointment state machine.
 *
 * Reception cancels a visit (the patient left), the doctor's screen is stale
 * (SSE dropped), the doctor presses «Завершить приём»: the cancelled visit
 * became COMPLETED, the patient got «Спасибо за визит» and an NPS request,
 * and the visit counted in the stats. Finalize now applies the same
 * `canTransitionAt` rule as the appointment PATCH: only IN_PROGRESS closes,
 * a COMPLETED visit stays signable («sign later» from «Заключения»), and
 * anything else answers 409 `appointment_not_active` before a single write.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  refreshStats: vi.fn(async () => undefined),
}));

const state = {
  note: null as Row | null,
  noteUpdates: [] as Row[],
  appointmentUpdates: [] as Row[],
  revisions: [] as Row[],
  /** Simulates a cancel landing between the guard and the write. */
  appointmentGoneBeforeWrite: false,
};

function draftNote(appointment: Row): Row {
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
    complaints: ["Головная боль"],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: [],
    followUpDays: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение.",
    patientHandoutMarkdown: null,
    updatedAt: new Date(),
    patient: { fullName: "Рахимов Сардор" },
    doctor: { nameRu: "Султанов А.", specializationRu: "Невролог" },
    clinic: { nameRu: "NeuroFax" },
    visitPrescriptions: [],
    appointment: {
      id: "apt_1",
      date: new Date(Date.now() - 60 * 60_000),
      endDate: new Date(Date.now() - 30 * 60_000),
      completedAt: null,
      queueStatus: appointment.status,
      doctorId: "doc_1",
      patientId: "p1",
      cabinetId: null,
      ...appointment,
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
  allocateDocumentNumber: vi.fn(async () => "NF-2026-000099"),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
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
      findUnique: vi.fn(async () => state.note),
      update: vi.fn(async ({ data }: { data: Row }) => {
        state.noteUpdates.push(data);
        return { ...state.note, ...data };
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
      update: vi.fn(
        async ({ where, data }: { where: Row; data: Row }) => {
          if (state.appointmentGoneBeforeWrite) {
            // What Prisma does when the conditional where matches no row.
            throw Object.assign(new Error("Record to update not found."), {
              code: "P2025",
            });
          }
          state.appointmentUpdates.push({ where, data });
          return { ...(state.note?.appointment as Row), ...data };
        },
      ),
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

beforeEach(() => {
  state.note = null;
  state.noteUpdates = [];
  state.appointmentUpdates = [];
  state.revisions = [];
  state.appointmentGoneBeforeWrite = false;
  h.fireTrigger.mockClear();
  h.refreshStats.mockClear();
});

describe("VW-03: finalize obeys the appointment state machine", () => {
  for (const status of ["CANCELLED", "NO_SHOW"] as const) {
    it(`refuses a ${status} visit with 409 and writes nothing`, async () => {
      state.note = draftNote({ status });

      const res = await finalize();

      expect(res.status).toBe(409);
      const body = (await res.json()) as Row;
      expect(body.reason).toBe("appointment_not_active");
      expect(body.from).toBe(status);
      // Not signed, no number burned, no revision, the visit untouched.
      expect(state.noteUpdates).toEqual([]);
      expect(state.revisions).toEqual([]);
      expect(state.appointmentUpdates).toEqual([]);
      // No «Спасибо за визит», no NPS, no visit stats bump.
      expect(h.fireTrigger).not.toHaveBeenCalled();
      expect(h.refreshStats).not.toHaveBeenCalled();
    });
  }

  it("a patient still in the waiting room is not closed by a signature either", async () => {
    state.note = draftNote({ status: "WAITING" });
    const res = await finalize();
    expect(res.status).toBe(409);
    expect(state.noteUpdates).toEqual([]);
  });

  it("signs and completes a visit in progress, conditional on its status", async () => {
    state.note = draftNote({ status: "IN_PROGRESS" });

    const res = await finalize();

    expect(res.status).toBe(200);
    expect(state.noteUpdates[0]).toMatchObject({ status: "FINALIZED" });
    expect(state.appointmentUpdates).toHaveLength(1);
    expect(state.appointmentUpdates[0].where).toEqual({
      id: "apt_1",
      status: "IN_PROGRESS",
    });
    expect(state.appointmentUpdates[0].data).toMatchObject({
      status: "COMPLETED",
      queueStatus: "COMPLETED",
    });
    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.completed",
      appointmentId: "apt_1",
    });
  });

  it("still signs the draft of an already completed visit (sign later)", async () => {
    state.note = draftNote({ status: "COMPLETED", completedAt: new Date() });

    const res = await finalize();

    expect(res.status).toBe(200);
    expect(state.noteUpdates[0]).toMatchObject({ status: "FINALIZED" });
    expect(state.appointmentUpdates).toEqual([]);
    expect(h.fireTrigger).not.toHaveBeenCalled();
  });

  it("a cancel landing between the guard and the write rolls the signature back", async () => {
    state.note = draftNote({ status: "IN_PROGRESS" });
    state.appointmentGoneBeforeWrite = true;

    const res = await finalize();

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("appointment_not_active");
    // The transaction threw, so the note update inside it never commits;
    // nothing after the transaction ran either.
    expect(h.fireTrigger).not.toHaveBeenCalled();
    expect(h.refreshStats).not.toHaveBeenCalled();
  });
});

describe("VW-03: the doctor is told why nothing was signed", () => {
  const root = path.resolve(__dirname, "../..");
  for (const lang of ["ru", "uz"]) {
    it(`${lang}: visit screen and My Day both have the message, no dashes`, () => {
      const m = JSON.parse(
        readFileSync(path.join(root, `src/messages/${lang}.json`), "utf8"),
      ) as {
        doctor: {
          reception: { activePatient: Record<string, string> };
          myDay: { statusToast: Record<string, string> };
        };
      };
      for (const text of [
        m.doctor.reception.activePatient.finalizeNotActive,
        m.doctor.reception.activePatient.finalizeUnsaved,
        m.doctor.myDay.statusToast.errNotActive,
      ]) {
        expect(text).toBeTruthy();
        expect(text).not.toMatch(/[—–]/);
      }
    });
  }
});
