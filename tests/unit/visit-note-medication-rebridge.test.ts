/**
 * In-window corrections must reach the PATIENT'S REMINDERS, not just the PDF.
 *
 * Bug being locked down: the medication bridge (VisitPrescription →
 * Prescription → Mini App reminders) ran exactly once, gated on
 * `medicationsBridgedAt IS NULL`, and PATCH never cleared that stamp. A doctor
 * fixing a dosage inside the legal 24h window re-rendered the conclusion PDF
 * but left the patient being reminded on the WITHDRAWN schedule — i.e. taking
 * a regimen the doctor had already cancelled.
 *
 * The contract under test:
 *   - a PATCH that really changes `visitPrescriptions` on a FINALIZED note
 *     clears `medicationsBridgedAt`, putting the note back into the sweep;
 *   - a PATCH that only touches text (or resends an identical list) does NOT —
 *     courses the patient already follows must not be disturbed, and
 *     `prescription.created` must not be re-emitted;
 *   - the re-bridge RECONCILES: surviving rows are updated in place (no
 *     duplicate courses), withdrawn rows are CANCELLED;
 *   - withdrawal is a status flip, never a delete — `MedicationReminderSend`
 *     cascades on delete, and the patient's own «принял / пропустил» answers
 *     are history we must not rewrite.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

const state = {
  patchNote: null as Record<string, unknown> | null,
  patchNoteUpdates: [] as Array<Record<string, unknown>>,
  /** Rows the PATCH route reads back to diff against the incoming list. */
  existingRxRows: [] as Array<Record<string, unknown>>,
  /** Bridge sweep input. */
  bridgeNotes: [] as Array<Record<string, unknown>>,
  /** Existing Prescription rows keyed by `${visitNoteId}:${sortOrder}`. */
  prescriptions: new Map<string, Record<string, unknown>>(),
  prescriptionUpserts: [] as Array<Record<string, unknown>>,
  prescriptionUpdateManys: [] as Array<Record<string, unknown>>,
  prescriptionDeletes: [] as unknown[],
  reminderSendWrites: [] as unknown[],
  publishedEvents: [] as Array<Record<string, unknown>>,
  bridgeStamps: [] as Array<Record<string, unknown>>,
};

const RX_BASE = {
  displayName: "Конкор",
  strength: "5 мг",
  dose: "1 таб",
  timesOfDay: ["MORNING"],
  mealRelation: "NO_MATTER",
  durationDays: 30,
  instructionRu: "утром",
  instructionUz: null,
  remindPatient: true,
};

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "SYSTEM" as const }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/server/queue", () => ({
  getQueue: () => ({
    registerWorker: vi.fn(),
    repeat: vi.fn(() => ({ stop: vi.fn() })),
  }),
}));

vi.mock("@/server/prescription/cipher-fields", () => ({
  serializePrescriptionForWrite: (x: { notes: string | null }) => x,
}));

vi.mock("@/server/actions/repository", () => ({
  upsertAction: vi.fn(async () => undefined),
}));

vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async (_tx: unknown, e: Record<string, unknown>) => {
    state.publishedEvents.push(e);
  }),
}));

vi.mock("@/lib/prisma", () => {
  const rxKey = (visitNoteId: string, sortOrder: number) =>
    `${visitNoteId}:${sortOrder}`;

  const prescription = {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: {
          visitNoteId_visitNoteSortOrder: {
            visitNoteId: string;
            visitNoteSortOrder: number;
          };
        };
      }) => {
        const k = where.visitNoteId_visitNoteSortOrder;
        return (
          state.prescriptions.get(
            rxKey(k.visitNoteId, k.visitNoteSortOrder),
          ) ?? null
        );
      },
    ),
    upsert: vi.fn(
      async (args: {
        where: {
          visitNoteId_visitNoteSortOrder: {
            visitNoteId: string;
            visitNoteSortOrder: number;
          };
        };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        state.prescriptionUpserts.push(args);
        const k = args.where.visitNoteId_visitNoteSortOrder;
        const key = rxKey(k.visitNoteId, k.visitNoteSortOrder);
        const prev = state.prescriptions.get(key);
        const row = prev
          ? { ...prev, ...args.update }
          : { id: `rx_${key}`, status: "ACTIVE", ...args.create };
        state.prescriptions.set(key, row);
        return row;
      },
    ),
    updateMany: vi.fn(
      async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.prescriptionUpdateManys.push(args);
        const where = args.where as {
          visitNoteId: string;
          status?: { in: string[] };
          visitNoteSortOrder?: { notIn: number[] };
        };
        let count = 0;
        for (const [key, row] of state.prescriptions.entries()) {
          if (row.visitNoteId !== where.visitNoteId) continue;
          if (
            where.status?.in &&
            !where.status.in.includes(row.status as string)
          ) {
            continue;
          }
          if (
            where.visitNoteSortOrder?.notIn &&
            where.visitNoteSortOrder.notIn.includes(
              row.visitNoteSortOrder as number,
            )
          ) {
            continue;
          }
          state.prescriptions.set(key, { ...row, ...args.data });
          count += 1;
        }
        return { count };
      },
    ),
    // Present so an accidental hard-delete would be observable, not silent.
    delete: vi.fn(async (args: unknown) => {
      state.prescriptionDeletes.push(args);
      return {};
    }),
    deleteMany: vi.fn(async (args: unknown) => {
      state.prescriptionDeletes.push(args);
      return { count: 0 };
    }),
  };

  const medicationReminderSend = {
    update: vi.fn(async (a: unknown) => {
      state.reminderSendWrites.push(a);
      return {};
    }),
    updateMany: vi.fn(async (a: unknown) => {
      state.reminderSendWrites.push(a);
      return { count: 0 };
    }),
    delete: vi.fn(async (a: unknown) => {
      state.reminderSendWrites.push(a);
      return {};
    }),
    deleteMany: vi.fn(async (a: unknown) => {
      state.reminderSendWrites.push(a);
      return { count: 0 };
    }),
  };

  const tx = {
    prescription,
    medicationReminderSend,
    visitNote: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.patchNoteUpdates.push(data);
        if (state.patchNote) state.patchNote = { ...state.patchNote, ...data };
        return { ...(state.patchNote ?? {}), visitPrescriptions: [] };
      }),
    },
    visitPrescription: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    $executeRaw: vi.fn(async () => 1),
  };

  return {
    prisma: {
      visitNote: {
        findMany: vi.fn(async () => state.bridgeNotes),
        findUnique: vi.fn(async () => state.patchNote),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.bridgeStamps.push(data);
          state.patchNoteUpdates.push(data);
          if (state.patchNote) {
            state.patchNote = { ...state.patchNote, ...data };
          }
          return { ...(state.patchNote ?? {}), visitPrescriptions: [] };
        }),
      },
      visitPrescription: {
        ...tx.visitPrescription,
        findMany: vi.fn(async () => state.existingRxRows),
      },
      prescription,
      medicationReminderSend,
      doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
      clinic: {
        findUnique: vi.fn(async () => ({
          medicationRemindersEnabled: true,
          medicationSlotTimes: null,
          timezone: "Asia/Tashkent",
        })),
      },
      $executeRaw: tx.$executeRaw,
      $transaction: vi.fn(
        async <T,>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
      ),
    },
  };
});

beforeEach(() => {
  state.patchNote = null;
  state.patchNoteUpdates = [];
  state.existingRxRows = [];
  state.bridgeNotes = [];
  state.prescriptions = new Map();
  state.prescriptionUpserts = [];
  state.prescriptionUpdateManys = [];
  state.prescriptionDeletes = [];
  state.reminderSendWrites = [];
  state.publishedEvents = [];
  state.bridgeStamps = [];
});

// ----- helpers -------------------------------------------------------------

function finalizedNote(hoursAgo: number): Record<string, unknown> {
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "FINALIZED",
    finalizedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    medicationsBridgedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    handoutStaleAt: null,
    updatedAt: new Date(),
  };
}

function patchReq(body: unknown): Request {
  return new Request("https://x/api/crm/visit-notes/vn_1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A full VisitPrescription row as stored (what the diff reads back). */
function storedRx(over: Record<string, unknown> = {}) {
  return { ...RX_BASE, ...over };
}

/** The same row as the client sends it (schema-shaped draft). */
function draftRx(over: Record<string, unknown> = {}) {
  return { drugId: null, form: null, ...RX_BASE, ...over };
}

// ----- PATCH: does the bridge get reopened? --------------------------------

describe("PATCH — medication bridge reset on prescription edits", () => {
  it("clears medicationsBridgedAt when a dosage really changes in-window", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(1);
    state.existingRxRows = [storedRx({ dose: "1 таб" })];

    const res = await PATCH(
      patchReq({ visitPrescriptions: [draftRx({ dose: "2 таб" })] }),
    );
    expect(res.status).toBe(200);

    const data = state.patchNoteUpdates[0];
    // Back into the sweep — the patient's reminders get rebuilt.
    expect(data.medicationsBridgedAt).toBeNull();
    // …and the PDF is re-rendered too (pre-existing behaviour, still intact).
    expect(data.handoutStaleAt).toBeInstanceOf(Date);
  });

  it("does NOT touch the bridge when only the conclusion text is edited", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(1);

    const res = await PATCH(patchReq({ bodyMarkdown: "исправленная опечатка" }));
    expect(res.status).toBe(200);

    const data = state.patchNoteUpdates[0];
    // The key must be absent entirely — courses the patient is already
    // following must not be rebuilt because of a typo fix.
    expect("medicationsBridgedAt" in data).toBe(false);
    expect(data.handoutStaleAt).toBeInstanceOf(Date);
  });

  it("does NOT touch the bridge when the editor resends an identical list", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(1);
    state.existingRxRows = [storedRx()];

    const res = await PATCH(patchReq({ visitPrescriptions: [draftRx()] }));
    expect(res.status).toBe(200);

    const data = state.patchNoteUpdates[0];
    expect("medicationsBridgedAt" in data).toBe(false);
    // A no-op save is not an edit: the PDF must not be marked stale either.
    expect(data.handoutStaleAt).toBeUndefined();
  });

  it("reopens the bridge when a drug is removed entirely", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(2);
    state.existingRxRows = [storedRx(), storedRx({ displayName: "Аспирин" })];

    const res = await PATCH(patchReq({ visitPrescriptions: [draftRx()] }));
    expect(res.status).toBe(200);
    expect(state.patchNoteUpdates[0].medicationsBridgedAt).toBeNull();
  });

  it("reopens the bridge when «напоминать» is switched off", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(2);
    state.existingRxRows = [storedRx({ remindPatient: true })];

    const res = await PATCH(
      patchReq({ visitPrescriptions: [draftRx({ remindPatient: false })] }),
    );
    expect(res.status).toBe(200);
    expect(state.patchNoteUpdates[0].medicationsBridgedAt).toBeNull();
  });

  it("rejects a prescription edit after the 24h window (nothing written)", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(48);
    state.existingRxRows = [storedRx()];

    const res = await PATCH(
      patchReq({ visitPrescriptions: [draftRx({ dose: "3 таб" })] }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("edit_window_expired");
    expect(state.patchNoteUpdates).toHaveLength(0);
  });

  it("accepts a diagnosis + follow-up correction inside the window", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = finalizedNote(3);

    const res = await PATCH(
      patchReq({
        diagnosisCode: "I10",
        diagnosisName: "Гипертензия",
        followUpDays: 14,
        followUpNote: "контроль АД",
      }),
    );
    expect(res.status).toBe(200);
    const data = state.patchNoteUpdates[0];
    expect(data.diagnosisCode).toBe("I10");
    expect(data.followUpDays).toBe(14);
    // Follow-up/diagnosis are not prescriptions — the bridge stays as is.
    expect("medicationsBridgedAt" in data).toBe(false);
  });
});

// ----- Bridge sweep: reconciliation ----------------------------------------

describe("medication bridge — reconciliation on re-run", () => {
  function bridgeNote(rows: Array<Record<string, unknown>>) {
    return {
      id: "vn_1",
      clinicId: "c1",
      patientId: "p1",
      doctorId: "doc_1",
      finalizedAt: new Date("2026-08-20T06:00:00.000Z"),
      followUpDays: null,
      followUpNote: null,
      patient: { fullName: "Тест Пациент", preferredLang: "RU" },
      doctor: { nameRu: "Иванов И.И." },
      visitPrescriptions: rows,
    };
  }

  it("updates the existing course in place instead of duplicating it", async () => {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");

    // The course as first bridged.
    state.prescriptions.set("vn_1:0", {
      id: "rx_vn_1:0",
      visitNoteId: "vn_1",
      visitNoteSortOrder: 0,
      drugName: "Конкор",
      dosage: "1 таб (5 мг)",
      status: "ACTIVE",
      remindersEnabled: true,
    });

    // The doctor corrected the dose to 2 таб.
    state.bridgeNotes = [
      bridgeNote([{ ...RX_BASE, dose: "2 таб", sortOrder: 0 }]),
    ];

    await mod.runMedicationBridgeTick(new Date("2026-08-20T10:00:00.000Z"));

    // Still ONE course for this note — upserted on (visitNoteId, sortOrder).
    const forNote = [...state.prescriptions.values()].filter(
      (r) => r.visitNoteId === "vn_1",
    );
    expect(forNote).toHaveLength(1);
    expect(forNote[0].dosage).toBe("2 таб (5 мг)");
    expect(forNote[0].status).toBe("ACTIVE");

    // An already-known row must not re-announce itself to the Mini App.
    const created = state.publishedEvents.filter(
      (e) => e.type === "prescription.created",
    );
    expect(created).toHaveLength(0);
  });

  it("CANCELS a withdrawn course instead of deleting it (reminder history is preserved)", async () => {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");

    for (const i of [0, 1]) {
      state.prescriptions.set(`vn_1:${i}`, {
        id: `rx_vn_1:${i}`,
        visitNoteId: "vn_1",
        visitNoteSortOrder: i,
        drugName: i === 0 ? "Конкор" : "Аспирин",
        dosage: "1 таб",
        status: "ACTIVE",
        remindersEnabled: true,
      });
    }

    // Аспирин (sortOrder 1) was removed during the in-window correction.
    state.bridgeNotes = [bridgeNote([{ ...RX_BASE, sortOrder: 0 }])];

    await mod.runMedicationBridgeTick(new Date("2026-08-20T10:00:00.000Z"));

    expect(state.prescriptions.get("vn_1:0")!.status).toBe("ACTIVE");
    const withdrawn = state.prescriptions.get("vn_1:1")!;
    expect(withdrawn.status).toBe("CANCELLED");
    // Reminders stop being scheduled for it…
    expect(withdrawn.remindersEnabled).toBe(false);
    // …but the row itself survives: deleting it would cascade away the
    // patient's own «принял / пропустил» answers.
    expect(state.prescriptionDeletes).toHaveLength(0);
  });

  it("never rewrites already-sent reminders", async () => {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");

    state.prescriptions.set("vn_1:0", {
      id: "rx_vn_1:0",
      visitNoteId: "vn_1",
      visitNoteSortOrder: 0,
      drugName: "Конкор",
      dosage: "1 таб (5 мг)",
      status: "ACTIVE",
      remindersEnabled: true,
    });

    state.bridgeNotes = [
      bridgeNote([{ ...RX_BASE, dose: "2 таб", sortOrder: 0 }]),
    ];

    await mod.runMedicationBridgeTick(new Date("2026-08-20T10:00:00.000Z"));

    // Whatever the patient was already told, and however they answered, is
    // history. The rebuild only changes what happens from now on.
    expect(state.reminderSendWrites).toHaveLength(0);
  });

  it("re-activates a course the doctor restored after cancelling it", async () => {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");

    state.prescriptions.set("vn_1:0", {
      id: "rx_vn_1:0",
      visitNoteId: "vn_1",
      visitNoteSortOrder: 0,
      drugName: "Конкор",
      dosage: "1 таб (5 мг)",
      status: "CANCELLED",
      remindersEnabled: false,
    });

    state.bridgeNotes = [bridgeNote([{ ...RX_BASE, sortOrder: 0 }])];

    await mod.runMedicationBridgeTick(new Date("2026-08-20T10:00:00.000Z"));

    const row = state.prescriptions.get("vn_1:0")!;
    expect(row.status).toBe("ACTIVE");
    expect(row.remindersEnabled).toBe(true);
  });

  it("re-stamps medicationsBridgedAt so the note leaves the sweep again", async () => {
    vi.resetModules();
    const mod = await import("@/server/workers/visit-note-handout");
    state.bridgeNotes = [bridgeNote([{ ...RX_BASE, sortOrder: 0 }])];

    const now = new Date("2026-08-20T10:00:00.000Z");
    const out = await mod.runMedicationBridgeTick(now);

    expect(out.bridged).toBe(1);
    expect(state.bridgeStamps).toHaveLength(1);
    expect(state.bridgeStamps[0].medicationsBridgedAt).toEqual(now);
  });
});

// ----- pure diff -----------------------------------------------------------

describe("didPrescriptionsChange", () => {
  it("ignores a no-op resend and normalises null vs undefined", async () => {
    const { didPrescriptionsChange } = await import(
      "@/server/visit-notes/prescription-diff"
    );
    expect(didPrescriptionsChange([storedRx()], [draftRx()])).toBe(false);
    // `strength: null` (Prisma) vs missing (body) is not a clinical edit.
    expect(
      didPrescriptionsChange(
        [storedRx({ strength: null, instructionRu: null })],
        [{ ...draftRx(), strength: undefined, instructionRu: undefined }],
      ),
    ).toBe(false);
  });

  it("catches every patient-visible change", async () => {
    const { didPrescriptionsChange } = await import(
      "@/server/visit-notes/prescription-diff"
    );
    const base = [storedRx()];
    const cases: Array<Record<string, unknown>> = [
      { dose: "2 таб" },
      { displayName: "Эгилок" },
      { strength: "10 мг" },
      { timesOfDay: ["MORNING", "EVENING"] },
      { mealRelation: "AFTER_MEAL" },
      { durationDays: 10 },
      { instructionRu: "вечером" },
      { remindPatient: false },
    ];
    for (const over of cases) {
      expect(didPrescriptionsChange(base, [draftRx(over)])).toBe(true);
    }
    // Added / removed rows.
    expect(didPrescriptionsChange(base, [draftRx(), draftRx()])).toBe(true);
    expect(didPrescriptionsChange(base, [])).toBe(true);
  });

  it("treats reordering as a change (sortOrder is the bridge key)", async () => {
    const { didPrescriptionsChange } = await import(
      "@/server/visit-notes/prescription-diff"
    );
    const a = storedRx({ displayName: "A" });
    const b = storedRx({ displayName: "B" });
    expect(
      didPrescriptionsChange(
        [a, b],
        [draftRx({ displayName: "B" }), draftRx({ displayName: "A" })],
      ),
    ).toBe(true);
  });

  it("ignores catalog bookkeeping that never reaches the patient", async () => {
    const { didPrescriptionsChange } = await import(
      "@/server/visit-notes/prescription-diff"
    );
    expect(
      didPrescriptionsChange(
        [storedRx()],
        [draftRx({ drugId: "drug_123", form: "таблетки" })],
      ),
    ).toBe(false);
  });
});
