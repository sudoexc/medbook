/**
 * Audit DC-01: «Завершить приём» on My Day closed the visit around an
 * unsigned conclusion.
 *
 * The button (and the «switch to the next patient» flow) sent the generic
 * status PATCH, which never touches the note. The conclusion stayed a draft
 * for good: no number, no PatientDiagnosis, nothing sent to the patient, and
 * the reception screen could no longer open it. Now the server refuses a
 * doctor's completion while the visit carries a draft with content (409
 * `visit_note_unsigned`, naming the note and what it lacks); My Day offers
 * to sign it, and finalize signs and completes in one step.
 *
 * The same file pins the visit REVERT side of VW-02 and G1-01: un-signing a
 * conclusion clears its composed handout (the next signature composes it
 * afresh) and keeps the signed state on record first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  draftHasContent,
  emptyConclusionSections,
} from "@/lib/visit-note-sections";

// ----- shared in-memory state ----------------------------------------------

type Role = "DOCTOR" | "ADMIN";

const state = {
  role: "DOCTOR" as Role,
  apt: null as Record<string, unknown> | null,
  draft: null as Record<string, unknown> | null,
  signedNote: null as Record<string, unknown> | null,
  appointmentUpdates: [] as Array<Record<string, unknown>>,
  noteUpdates: [] as Array<Record<string, unknown>>,
  revisions: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ action: string; meta: unknown }>,
};

function userId(): string {
  return state.role === "DOCTOR" ? "u_doc_1" : "u_admin";
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: state.role === "DOCTOR" ? "u_doc_1" : "u_admin",
      role: state.role,
      clinicId: "c1",
      email: "x@example.test",
    },
  })),
}));

vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: userId(),
    role: state.role,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: Request, e: { action: string; meta: unknown }) => {
    state.audits.push({ action: e.action, meta: e.meta });
  }),
}));

vi.mock("@/server/services/appointments", () => ({
  applyTime: (date: Date) => date,
  computeEndDate: (start: Date, d: number) =>
    new Date(start.getTime() + d * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: vi.fn(async () => undefined),
}));

vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/appointments/emit-change", () => ({
  emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
}));
// The single-active check runs inside the start write's own transaction
// (Q-13); here the doctor never has another visit on the table, so the
// wrapper just runs the write in the mocked transaction.
vi.mock("@/server/appointments/active-visit", () => ({
  AnotherVisitInProgressError: class AnotherVisitInProgressError extends Error {},
  orActiveVisitConflict: <T,>(run: Promise<T>) => run,
  runStartVisitTx: vi.fn(
    async (_params: unknown, write: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import("@/lib/prisma");
      return prisma.$transaction(write as never);
    },
  ),
}));
vi.mock("@/server/patient-experience/referral-mint", () => ({
  mintReferralRewardOnCompletion: vi.fn(async () => ({
    minted: false,
    rewardId: null,
  })),
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
  refreshPatientVisitStats: vi.fn(async () => undefined),
}));
vi.mock("@/lib/appointment-transitions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appointment-transitions")>()),
  canTransitionAt: () => ({ ok: true }),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    appointment: {
      findUnique: vi.fn(async () => state.apt),
      findUniqueOrThrow: vi.fn(async () => state.apt),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.appointmentUpdates.push(data);
        state.apt = { ...state.apt, ...data };
        return state.apt;
      }),
    },
    visitNote: {
      findFirst: vi.fn(async ({ where }: { where: { status: string } }) =>
        where.status === "DRAFT" ? state.draft : state.signedNote,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.noteUpdates.push(data);
        return { ...state.signedNote, ...data };
      }),
    },
    visitNoteRevision: {
      findFirst: vi.fn(async () =>
        state.revisions.length
          ? state.revisions[state.revisions.length - 1]
          : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
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
    prescription: { updateMany: vi.fn(async () => ({ count: 0 })) },
    eventOutbox: { create: vi.fn(async () => ({ id: "o1" })) },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) =>
      fn(prisma),
    ),
  };
  return { prisma };
});

// ----- helpers -------------------------------------------------------------

async function loadPatch() {
  vi.resetModules();
  return (await import("@/app/api/crm/appointments/[id]/route")).PATCH;
}

function req(body: unknown, query = ""): Request {
  return new Request(`https://x/api/crm/appointments/apt_1${query}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draftNote(over: Record<string, unknown> = {}) {
  return {
    id: "vn_1",
    diagnosisCode: null,
    diagnosisName: "Мигрень без ауры",
    bodyMarkdown: "Жалобы на головную боль.",
    prescriptions: [],
    complaints: [],
    anamnesis: [],
    examination: [],
    advice: [],
    _count: { visitPrescriptions: 0 },
    ...over,
  };
}

beforeEach(() => {
  state.role = "DOCTOR";
  state.apt = {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    cabinetId: null,
    date: new Date("2026-09-25T05:00:00.000Z"),
    endDate: new Date("2026-09-25T05:30:00.000Z"),
    durationMin: 30,
    time: "10:00",
    status: "IN_PROGRESS",
    queueStatus: "IN_PROGRESS",
    startedAt: new Date("2026-09-25T05:00:00.000Z"),
    completedAt: null,
    cancelledAt: null,
    medicalCaseId: null,
    priceBase: null,
    channel: "BOOKING",
    doctor: { userId: "u_doc_1" },
  };
  state.draft = null;
  state.signedNote = null;
  state.appointmentUpdates = [];
  state.noteUpdates = [];
  state.revisions = [];
  state.audits = [];
});

// ----- tests ---------------------------------------------------------------

describe("DC-01: a doctor cannot close a visit around an unsigned conclusion", () => {
  it("refuses COMPLETED with 409 visit_note_unsigned, naming the note and what it lacks", async () => {
    state.draft = draftNote();
    const PATCH = await loadPatch();

    const res = await PATCH(req({ status: "COMPLETED" }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      reason: string;
      visitNoteId: string;
      emptySections: string[];
    };
    expect(body.reason).toBe("visit_note_unsigned");
    expect(body.visitNoteId).toBe("vn_1");
    expect(body.emptySections).toEqual(["prescriptions"]);
    // Nothing was closed.
    expect(state.appointmentUpdates).toHaveLength(0);
  });

  it("lets the visit close when the draft is empty: there is nothing to sign", async () => {
    state.draft = draftNote({ diagnosisName: null, bodyMarkdown: "  " });
    const PATCH = await loadPatch();

    const res = await PATCH(req({ status: "COMPLETED" }));

    expect(res.status).toBe(200);
    expect(state.appointmentUpdates[0]?.status).toBe("COMPLETED");
  });

  it("lets the visit close when there is no draft at all", async () => {
    const PATCH = await loadPatch();
    const res = await PATCH(req({ status: "COMPLETED" }));
    expect(res.status).toBe(200);
  });

  it("does not stop reception staff: the doctor signs later from «Заключения»", async () => {
    state.role = "ADMIN";
    state.draft = draftNote();
    const PATCH = await loadPatch();

    const res = await PATCH(req({ status: "COMPLETED" }));

    expect(res.status).toBe(200);
    expect(state.appointmentUpdates[0]?.status).toBe("COMPLETED");
  });
});

describe("visit revert: un-signing keeps the signed state and drops the stale handout", () => {
  beforeEach(() => {
    state.apt = {
      ...state.apt,
      status: "COMPLETED",
      queueStatus: "COMPLETED",
      completedAt: new Date("2026-09-25T05:40:00.000Z"),
    };
    state.signedNote = {
      id: "vn_1",
      clinicId: "c1",
      status: "FINALIZED",
      documentNumber: "NF-2026-000042",
      diagnosisCode: "I10",
      diagnosisName: "Гипертензия",
      complaints: [],
      anamnesis: [],
      examination: [],
      prescriptions: [],
      advice: [],
      bodyMarkdown: "Текст",
      patientHandoutMarkdown: "# Памятка\n- Конкор 5 мг утром",
      followUpDays: null,
      followUpNote: null,
      dynamics: null,
      dynamicsNote: null,
      bodyMap: null,
      visitPrescriptions: [
        {
          displayName: "Конкор",
          dose: "5 мг",
          timesOfDay: ["MORNING"],
          mealRelation: "NO_MATTER",
          remindPatient: true,
          sortOrder: 0,
        },
      ],
    };
  });

  it("clears the composed handout and records the signed state first (G1-01)", async () => {
    const PATCH = await loadPatch();

    const res = await PATCH(req({ status: "IN_PROGRESS" }, "?revert=true"));

    expect(res.status).toBe(200);
    const unsign = state.noteUpdates[0]!;
    expect(unsign.status).toBe("DRAFT");
    expect(unsign.patientHandoutMarkdown).toBeNull();

    // No revision held the signed state (signed before revisions existed):
    // it is kept now, with the PDF the patient was issued.
    expect(state.revisions).toHaveLength(1);
    const kept = state.revisions[0]!;
    expect(kept.kind).toBe("PRE_EDIT");
    expect(kept.revision).toBe(1);
    expect(kept.pdfObjectKey).toBe("clinics/c1/conclusions/vn_1.pdf");
    const content = kept.content as {
      patientHandoutMarkdown: string;
      visitPrescriptions: Array<{ dose: string }>;
    };
    expect(content.patientHandoutMarkdown).toContain("Конкор 5 мг");
    expect(content.visitPrescriptions[0]!.dose).toBe("5 мг");
  });

  it("adds nothing when a revision already holds the signed state", async () => {
    state.revisions = [{ revision: 1, kind: "SIGNED", content: {} }];
    const PATCH = await loadPatch();

    await PATCH(req({ status: "IN_PROGRESS" }, "?revert=true"));

    expect(state.revisions).toHaveLength(1);
  });
});

describe("DC-01: one definition of an empty conclusion", () => {
  const base = {
    diagnosisCode: null,
    diagnosisName: null,
    bodyMarkdown: null,
    prescriptions: [],
    structuredRx: 0,
  };

  it("lists what is missing", () => {
    expect(emptyConclusionSections(base)).toEqual([
      "diagnosis",
      "conclusion",
      "prescriptions",
    ]);
    expect(
      emptyConclusionSections({ ...base, diagnosisCode: "G43.0", structuredRx: 2 }),
    ).toEqual(["conclusion"]);
    expect(
      emptyConclusionSections({ ...base, prescriptions: ["Магне B6"] }),
    ).toEqual(["diagnosis", "conclusion"]);
  });

  it("an untouched draft has no content; any written section counts", () => {
    expect(draftHasContent(base)).toBe(false);
    expect(draftHasContent({ ...base, bodyMarkdown: "   " })).toBe(false);
    expect(draftHasContent({ ...base, complaints: ["Головная боль"] })).toBe(true);
    expect(draftHasContent({ ...base, structuredRx: 1 })).toBe(true);
    expect(draftHasContent({ ...base, advice: ["Сон 8 часов"] })).toBe(true);
  });
});
