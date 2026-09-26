/**
 * Audit AP-07 / PT-06: every path that completes a visit runs the same side
 * effects, through `runCompletionEffects`.
 *
 * Reception closing the current patient («Вызвать из очереди» completes it
 * through queue-status) used to skip the visit stats, the last-contact stamp,
 * «Спасибо за визит» and the referral reward, and the doctor's later
 * signature skipped them too because the visit already read COMPLETED. Only
 * the appointment PATCH ran them.
 *
 * Two halves:
 *   1. `runCompletionEffects` itself: all four effects, the thank-you only
 *      when asked, a failing effect never throws.
 *   2. The four completion paths (PATCH, queue-status, bulk-status, finalize)
 *      each call it, with the thank-you on the closing and not on a
 *      signature landing on a visit someone else closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  fireTrigger: vi.fn(),
  mint: vi.fn(async () => ({ minted: true, rewardId: "rw_1" })),
  bump: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
  /** Spy standing in for the shared function in the route suites. */
  effects: vi.fn(async () => undefined),
  role: "RECEPTIONIST" as "RECEPTIONIST" | "DOCTOR",
}));

// ----- 1. the shared function ----------------------------------------------

describe("runCompletionEffects", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: {} }));
    vi.doMock("@/server/notifications/triggers", () => ({
      fireTrigger: h.fireTrigger,
    }));
    vi.doMock("@/server/patient-experience/referral-mint", () => ({
      mintReferralRewardOnCompletion: h.mint,
    }));
    vi.doMock("@/server/patient/last-contacted", () => ({
      bumpPatientLastContact: h.bump,
      refreshPatientVisitStats: h.refresh,
    }));
    h.fireTrigger.mockClear();
    h.mint.mockClear();
    h.bump.mockClear();
    h.refresh.mockClear();
  });

  const input = (over: Row = {}) => ({
    request: new Request("https://x/api/crm/appointments/a1/queue-status"),
    clinicId: "c1",
    appointmentId: "a1",
    patientId: "p1",
    completedAt: new Date("2026-09-26T07:10:00.000Z"),
    thankPatient: true,
    ...over,
  });

  it("thanks the patient, mints the referral, moves last contact, recounts visits", async () => {
    const { runCompletionEffects } = await import(
      "@/server/appointments/completion-effects"
    );
    await runCompletionEffects(input());

    expect(h.fireTrigger).toHaveBeenCalledWith({
      kind: "appointment.completed",
      appointmentId: "a1",
    });
    expect(h.mint).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "c1",
        appointmentId: "a1",
        patientId: "p1",
      }),
    );
    expect(h.bump).toHaveBeenCalledWith(
      "p1",
      new Date("2026-09-26T07:10:00.000Z"),
    );
    expect(h.refresh).toHaveBeenCalledWith("p1");
  });

  it("thankPatient=false runs the data effects without messaging the patient", async () => {
    const { runCompletionEffects } = await import(
      "@/server/appointments/completion-effects"
    );
    await runCompletionEffects(input({ thankPatient: false }));

    expect(h.fireTrigger).not.toHaveBeenCalled();
    expect(h.mint).toHaveBeenCalledTimes(1);
    expect(h.bump).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("a failing referral mint does not stop the stats or throw", async () => {
    h.mint.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runCompletionEffects } = await import(
      "@/server/appointments/completion-effects"
    );
    await expect(runCompletionEffects(input())).resolves.toBeUndefined();
    expect(h.refresh).toHaveBeenCalledWith("p1");
    err.mockRestore();
  });
});

// ----- 2. the four completion paths ----------------------------------------

const state = {
  appts: new Map<string, Row>(),
  note: null as Row | null,
};

function appt(id: string, over: Row = {}): Row {
  const start = new Date(Date.now() - 20 * 60_000);
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    doctorId: "doc_1",
    cabinetId: null,
    channel: "PHONE",
    status: "IN_PROGRESS",
    queueStatus: "IN_PROGRESS",
    date: start,
    endDate: new Date(start.getTime() + 60 * 60_000),
    time: null,
    durationMin: 60,
    startedAt: start,
    completedAt: null,
    cancelledAt: null,
    queueOrder: null,
    ticketSeq: null,
    queuedAt: null,
    priceBase: null,
    discountPct: 0,
    discountAmount: 0,
    medicalCaseId: null,
    serviceId: null,
    ...over,
  };
}

function mountRouteMocks() {
  vi.resetModules();
  vi.doUnmock("@/server/notifications/triggers");
  vi.doUnmock("@/server/patient-experience/referral-mint");
  vi.doUnmock("@/server/patient/last-contacted");
  vi.doMock("@/lib/auth", () => ({
    auth: vi.fn(async () => ({
      user: {
        id: h.role === "DOCTOR" ? "u_doc" : "u_recept",
        role: h.role,
        clinicId: "c1",
        email: "x@example.test",
      },
    })),
  }));
  vi.doMock("@/lib/pin", () => ({ hasValidPin: () => false }));
  vi.doMock("@/lib/tenant-context", () => ({
    runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
    getTenant: () => ({
      kind: "TENANT" as const,
      clinicId: "c1",
      userId: h.role === "DOCTOR" ? "u_doc" : "u_recept",
      role: h.role,
    }),
  }));
  vi.doMock("@/server/platform/branch-cookie", () => ({
    readActiveBranchFromCookieHeader: () => null,
  }));
  vi.doMock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
  vi.doMock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
  vi.doMock("@/server/realtime/outbox", () => ({
    newCorrelationId: () => "corr_test",
    publishViaOutbox: vi.fn(async () => undefined),
  }));
  vi.doMock("@/server/appointments/emit-change", () => ({
    emitAppointmentChangeViaOutbox: vi.fn(async () => ({ eventId: "ev_1" })),
  }));
  vi.doMock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
  vi.doMock("@/server/telegram/call-notice", () => ({
    sendCallNotice: vi.fn(async () => true),
  }));
  vi.doMock("@/server/visit-notes/unsigned-draft", () => ({
    findUnsignedDraft: vi.fn(async () => null),
  }));
  vi.doMock("@/server/icd10/clinic-catalog", () => ({
    learnClinicDiagnosis: vi.fn(async () => undefined),
  }));
  vi.doMock("@/server/services/document-number", () => ({
    allocateDocumentNumber: vi.fn(async () => "NF-2026-000123"),
  }));
  vi.doMock("@/server/pricing/recompute-appointment-price", () => ({
    recomputeAppointmentPrice: vi.fn(async () => null),
    recomputeCaseAppointments: vi.fn(async () => undefined),
  }));
  vi.doMock("@/server/appointments/completion-effects", () => ({
    runCompletionEffects: h.effects,
  }));
  vi.doMock("@/lib/prisma", () => {
    const merge = (id: string, data: Row): Row => {
      const next = { ...state.appts.get(id), ...data };
      state.appts.set(id, next);
      return next;
    };
    const appointment = {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = state.appts.get(where.id);
        return row ? { ...row, doctor: { userId: "u_doc" } } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.appts.get(where.id),
      ),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => state.appts.get(id)).filter(Boolean),
      ),
      update: vi.fn(
        async ({ where, data }: { where: Row & { id: string }; data: Row }) => {
          const row = state.appts.get(where.id);
          if (!row || (where.status && row.status !== where.status)) {
            throw Object.assign(new Error("not found"), { code: "P2025" });
          }
          return {
            ...merge(where.id, data),
            patient: { fullName: "Каримов Азиз", telegramId: null, preferredLang: "RU" },
            doctor: { nameRu: "Султанов А.", ticketPrefix: "A", cabinet: null },
            clinic: { id: "c1", slug: "neurofax", tgBotToken: null, tgBotUsername: null },
          };
        },
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    };
    const prisma = {
      appointment,
      visitNote: {
        findUnique: vi.fn(async () => state.note),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async ({ data }: { data: Row }) => ({ ...state.note, ...data })),
      },
      visitNoteRevision: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Row }) => ({
          id: "rev_1",
          revision: data.revision,
        })),
      },
      document: { findUnique: vi.fn(async () => null) },
      doctor: {
        findFirst: vi.fn(async () => ({ id: "doc_1", nameRu: "Султанов А." })),
      },
      patientDiagnosis: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: "pd_1" })),
        update: vi.fn(async () => ({ id: "pd_1" })),
      },
      auditLog: { create: vi.fn(async () => ({ id: "al_1" })) },
      $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
    };
    return { prisma };
  });
}

function json(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function draftNoteFor(appointment: Row): Row {
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: appointment.id,
    patientId: appointment.patientId,
    doctorId: "doc_1",
    status: "DRAFT",
    finalizedAt: null,
    firstFinalizedAt: null,
    documentNumber: null,
    diagnosisCode: null,
    diagnosisName: null,
    complaints: [],
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
    patient: { fullName: "Каримов Азиз" },
    doctor: { nameRu: "Султанов А.", specializationRu: "Невролог" },
    clinic: { nameRu: "NeuroFax" },
    visitPrescriptions: [],
    appointment,
  };
}

describe("AP-07: every completion path runs the shared effects", () => {
  beforeEach(() => {
    mountRouteMocks();
    h.effects.mockClear();
    h.role = "RECEPTIONIST";
    state.appts = new Map();
    state.note = null;
  });

  it("queue-status COMPLETED from reception («Вызвать из очереди»)", async () => {
    state.appts.set("a1", appt("a1"));
    const { PATCH } = await import(
      "@/app/api/crm/appointments/[id]/queue-status/route"
    );
    const res = await PATCH(
      json("https://x/api/crm/appointments/a1/queue-status", "PATCH", {
        queueStatus: "COMPLETED",
      }),
    );
    expect(res.status).toBe(200);
    expect(h.effects).toHaveBeenCalledTimes(1);
    expect(h.effects).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "c1",
        appointmentId: "a1",
        patientId: "p_a1",
        thankPatient: true,
        completedAt: expect.any(Date),
      }),
    );
  });

  it("queue-status on a visit already COMPLETED runs nothing again", async () => {
    state.appts.set(
      "a1",
      appt("a1", {
        status: "COMPLETED",
        queueStatus: "COMPLETED",
        completedAt: new Date(),
      }),
    );
    const { PATCH } = await import(
      "@/app/api/crm/appointments/[id]/queue-status/route"
    );
    const res = await PATCH(
      json("https://x/api/crm/appointments/a1/queue-status", "PATCH", {
        queueStatus: "COMPLETED",
      }),
    );
    expect(res.status).toBe(200);
    expect(h.effects).not.toHaveBeenCalled();
  });

  it("the appointment PATCH to COMPLETED", async () => {
    state.appts.set("a1", appt("a1"));
    const { PATCH } = await import("@/app/api/crm/appointments/[id]/route");
    const res = await PATCH(
      json("https://x/api/crm/appointments/a1", "PATCH", { status: "COMPLETED" }),
    );
    expect(res.status).toBe(200);
    expect(h.effects).toHaveBeenCalledTimes(1);
    expect(h.effects).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "a1",
        patientId: "p_a1",
        thankPatient: true,
      }),
    );
  });

  it("bulk-status COMPLETED: once per row it actually closes", async () => {
    state.appts.set("a1", appt("a1"));
    state.appts.set("a2", appt("a2"));
    state.appts.set(
      "a3",
      appt("a3", {
        status: "COMPLETED",
        queueStatus: "COMPLETED",
        completedAt: new Date(Date.now() - 60 * 60_000),
      }),
    );
    const { POST } = await import(
      "@/app/api/crm/appointments/bulk-status/route"
    );
    const res = await POST(
      json("https://x/api/crm/appointments/bulk-status", "POST", {
        ids: ["a1", "a2", "a3"],
        status: "COMPLETED",
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).count).toBe(2);
    const closed = (h.effects.mock.calls as unknown as Array<[Row]>).map(
      (c) => c[0].appointmentId,
    );
    expect(closed).toEqual(["a1", "a2"]);
    // Both status columns and the completion stamp, like every other path;
    // the already-closed row keeps its own completedAt.
    expect(state.appts.get("a1")).toMatchObject({
      status: "COMPLETED",
      queueStatus: "COMPLETED",
      completedAt: expect.any(Date),
    });
    expect((state.appts.get("a3")!.completedAt as Date).getTime()).toBeLessThan(
      Date.now() - 59 * 60_000,
    );
  });

  it("finalize that closes the visit thanks the patient", async () => {
    h.role = "DOCTOR";
    const a = appt("a1");
    state.appts.set("a1", a);
    state.note = draftNoteFor(a);
    const { POST } = await import(
      "@/app/api/crm/visit-notes/[id]/finalize/route"
    );
    const res = await POST(
      json("https://x/api/crm/visit-notes/vn_1/finalize", "POST"),
    );
    expect(res.status).toBe(200);
    expect(h.effects).toHaveBeenCalledTimes(1);
    expect(h.effects).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: "a1", thankPatient: true }),
    );
  });

  it("a later finalize on a visit reception closed runs the data effects, never a second thank-you", async () => {
    h.role = "DOCTOR";
    const completedAt = new Date(Date.now() - 10 * 60_000);
    const a = appt("a1", {
      status: "COMPLETED",
      queueStatus: "COMPLETED",
      completedAt,
    });
    state.appts.set("a1", a);
    state.note = draftNoteFor(a);
    const { POST } = await import(
      "@/app/api/crm/visit-notes/[id]/finalize/route"
    );
    const res = await POST(
      json("https://x/api/crm/visit-notes/vn_1/finalize", "POST"),
    );
    expect(res.status).toBe(200);
    // Runs regardless of the status (it heals visits closed before the
    // effects were shared), but only the closing thanks the patient.
    expect(h.effects).toHaveBeenCalledTimes(1);
    expect(h.effects).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "a1",
        thankPatient: false,
        completedAt,
      }),
    );
  });
});
