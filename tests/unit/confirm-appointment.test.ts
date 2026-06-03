/**
 * Tests for `src/server/appointments/confirm.ts` — the single entry point
 * for "this appointment is now confirmed", called from FIVE call sites.
 *
 * The helper has more branches than callers usually realise:
 *   - 5 ConfirmationVia values all need to land in the update + audit row
 *   - terminal states refuse the flip (CANCELLED + NO_SHOW both map to
 *     "cancelled"; COMPLETED maps to "completed")
 *   - the idempotency branch (already confirmed) still defensively closes
 *     stale Actions but skips update / audit / events
 *   - the status flip only happens when BOTH status AND queueStatus are
 *     still "BOOKED" (drift via legacy paths leaves both columns alone)
 *   - close uses dedupeKeyFor(UNCONFIRMED_24H stub) — must match the
 *     detector emit so the row actually gets closed
 *   - actor-vs-system audit fields diverge on whether actorId is null
 *
 * Strategy: vi.mock the three collaborator modules (`@/lib/prisma`,
 * `@/server/realtime/publish`, `@/lib/audit-actions` indirectly via the
 * AUDIT_ACTION constant — but we just let that one through and assert on
 * the audit row's `action` field). The prisma stubs are plain `vi.fn()`
 * instances driven by per-test in-memory state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { dedupeKeyFor } from "@/lib/actions/types";

// ----- shared state ---------------------------------------------------------

type AppointmentRow = {
  id: string;
  status:
    | "BOOKED"
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW";
  queueStatus:
    | "BOOKED"
    | "CONFIRMED"
    | "WAITING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELLED";
  confirmedAt: Date | null;
  confirmedBy: string | null;
  confirmedVia: string | null;
  doctorId: string;
  date: Date;
};

type AuditRow = {
  clinicId: string;
  actorId: string | null;
  actorRole: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string;
  meta: {
    via: string;
    statusBefore: string;
    statusAfter: string;
    statusFlipped: boolean;
  };
  ip: string | null;
  userAgent: string | null;
};

type UpdateManyArgs = {
  where: {
    clinicId: string;
    dedupeKey: string;
    status: { in: string[] };
  };
  data: { status: string; doneAt: Date };
};

type PublishCall = {
  clinicId: string;
  event: { type: string; payload: Record<string, unknown> };
};

const state = {
  rows: new Map<string, AppointmentRow>(),
  audits: [] as AuditRow[],
  publishes: [] as PublishCall[],
  updateManyCalls: [] as UpdateManyArgs[],
  // Track how many times findUnique fires so we can assert the idempotent
  // path re-reads the row after the defensive close.
  findUniqueCount: 0,
  updateCount: 0,
};

function defaultRow(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: "apt_1",
    status: "BOOKED",
    queueStatus: "BOOKED",
    confirmedAt: null,
    confirmedBy: null,
    confirmedVia: null,
    doctorId: "doc_1",
    date: new Date("2026-06-01T10:00:00.000Z"),
    ...overrides,
  };
}

// ----- module mocks ---------------------------------------------------------

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (
      clinicId: string,
      event: { type: string; payload: Record<string, unknown> },
    ) => {
      state.publishes.push({ clinicId, event });
    },
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        state.findUniqueCount += 1;
        const row = state.rows.get(where.id);
        return row ? { ...row } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<AppointmentRow>;
        }) => {
          state.updateCount += 1;
          const existing = state.rows.get(where.id);
          if (!existing) throw new Error("update: row not found");
          const merged = { ...existing, ...data };
          state.rows.set(where.id, merged);
          return { ...merged };
        },
      ),
    },
    action: {
      updateMany: vi.fn(async (args: UpdateManyArgs) => {
        state.updateManyCalls.push(args);
        return { count: 0 };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: AuditRow }) => {
        state.audits.push(data);
        return { id: `audit_${state.audits.length}` };
      }),
    },
    // Phase B.2 — confirmAppointment writes via the outbox inside a tx. The
    // legacy assertions check `state.publishes`, so we flatten envelope rows
    // into the same {clinicId, event:{type,payload}} shape that the
    // publishEventSafe mock pushed.
    eventOutbox: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            clinicId: string;
            envelope: { type: string; payload: Record<string, unknown> };
          };
        }) => {
          state.publishes.push({
            clinicId: data.clinicId,
            event: { type: data.envelope.type, payload: data.envelope.payload },
          });
          return { id: "outbox_stub" };
        },
      ),
    },
    $transaction: vi.fn(
      async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    ),
  },
}));

// ----- helpers --------------------------------------------------------------

async function loadConfirm() {
  const mod = await import("@/server/appointments/confirm");
  return mod.confirmAppointment;
}

beforeEach(() => {
  state.rows = new Map();
  state.audits = [];
  state.publishes = [];
  state.updateManyCalls = [];
  state.findUniqueCount = 0;
  state.updateCount = 0;
});

// ----- tests ----------------------------------------------------------------

describe("confirmAppointment — via values write the correct ConfirmationVia (S1)", () => {
  const vias = [
    "BOOKING_AUTO",
    "MANUAL_CRM",
    "SMS_REPLY",
    "TG_BUTTON",
    "INBOUND_CALL",
  ] as const;

  for (const via of vias) {
    it(`writes confirmedVia=${via} into update + audit meta`, async () => {
      state.rows.set("apt_1", defaultRow());
      const confirmAppointment = await loadConfirm();

      const result = await confirmAppointment({
        appointmentId: "apt_1",
        clinicId: "c1",
        actorId: via === "MANUAL_CRM" ? "user_X" : null,
        via,
      });

      expect(result.ok).toBe(true);
      const { prisma } = await import("@/lib/prisma");
      const updateMock = prisma.appointment.update as ReturnType<typeof vi.fn>;
      expect(updateMock).toHaveBeenCalledTimes(1);
      const updateArg = updateMock.mock.calls[0]![0] as {
        data: { confirmedVia: string };
      };
      expect(updateArg.data.confirmedVia).toBe(via);
      expect(state.audits).toHaveLength(1);
      expect(state.audits[0]!.meta.via).toBe(via);
    });
  }
});

describe("confirmAppointment — happy path side effects (S2)", () => {
  it("fires all 5 documented side effects with the right shape", async () => {
    state.rows.set("apt_1", defaultRow());
    const confirmAppointment = await loadConfirm();

    const result = await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyConfirmed).toBe(false);

    const { prisma } = await import("@/lib/prisma");

    // 1. findUnique read before-state (exactly once on fresh path).
    expect(prisma.appointment.findUnique).toHaveBeenCalledTimes(1);

    // 2. appointment.update with timestamps + status flip + via.
    expect(prisma.appointment.update).toHaveBeenCalledTimes(1);
    const updateArg = (prisma.appointment.update as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as {
      where: { id: string };
      data: {
        confirmedAt: Date;
        confirmedBy: string;
        confirmedVia: string;
        status?: string;
        queueStatus?: string;
      };
    };
    expect(updateArg.where.id).toBe("apt_1");
    expect(updateArg.data.confirmedAt).toBeInstanceOf(Date);
    expect(updateArg.data.confirmedBy).toBe("user_42");
    expect(updateArg.data.confirmedVia).toBe("MANUAL_CRM");
    expect(updateArg.data.status).toBe("CONFIRMED");
    expect(updateArg.data.queueStatus).toBe("CONFIRMED");

    // 3. action.updateMany with dedupeKey + status filter + DONE/doneAt.
    expect(state.updateManyCalls).toHaveLength(1);
    const um = state.updateManyCalls[0]!;
    expect(um.where.clinicId).toBe("c1");
    expect(um.where.dedupeKey).toBe(
      "UNCONFIRMED_24H:appointmentId=apt_1",
    );
    expect(um.where.status).toEqual({ in: ["OPEN", "SNOOZED"] });
    expect(um.data.status).toBe("DONE");
    expect(um.data.doneAt).toBeInstanceOf(Date);

    // 4. audit row.
    expect(state.audits).toHaveLength(1);
    const audit = state.audits[0]!;
    expect(audit.clinicId).toBe("c1");
    expect(audit.action).toBe("APPOINTMENT_CONFIRMED");
    expect(audit.entityType).toBe("Appointment");
    expect(audit.entityId).toBe("apt_1");
    expect(audit.actorId).toBe("user_42");
    expect(audit.meta.via).toBe("MANUAL_CRM");
    expect(audit.meta.statusBefore).toBe("BOOKED");
    expect(audit.meta.statusAfter).toBe("CONFIRMED");
    expect(audit.meta.statusFlipped).toBe(true);

    // 5. two publishEventSafe calls.
    expect(state.publishes).toHaveLength(2);
    expect(state.publishes[0]!.event.type).toBe("queue.updated");
    expect(state.publishes[1]!.event.type).toBe("appointment.statusChanged");
  });
});

describe("confirmAppointment — not_found (S3)", () => {
  it("returns not_found and fires zero side effects when row missing", async () => {
    const confirmAppointment = await loadConfirm();

    const result = await confirmAppointment({
      appointmentId: "missing",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });

    const { prisma } = await import("@/lib/prisma");
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.action.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(state.publishes).toHaveLength(0);
  });
});

describe("confirmAppointment — terminal state refusals (S4)", () => {
  it("CANCELLED → reason=cancelled, no side effects", async () => {
    state.rows.set("apt_1", defaultRow({ status: "CANCELLED" }));
    const confirmAppointment = await loadConfirm();

    const result = await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });
    expect(result).toEqual({ ok: false, reason: "cancelled" });

    const { prisma } = await import("@/lib/prisma");
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.action.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(state.publishes).toHaveLength(0);
  });

  it("NO_SHOW → reason=cancelled (mapped together with CANCELLED), no side effects", async () => {
    state.rows.set("apt_1", defaultRow({ status: "NO_SHOW" }));
    const confirmAppointment = await loadConfirm();

    const result = await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });
    // Per src/server/appointments/confirm.ts: NO_SHOW shares the "cancelled"
    // reason; both are refused under the same branch.
    expect(result).toEqual({ ok: false, reason: "cancelled" });

    const { prisma } = await import("@/lib/prisma");
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.action.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(state.publishes).toHaveLength(0);
  });

  it("COMPLETED → reason=completed, no side effects", async () => {
    state.rows.set("apt_1", defaultRow({ status: "COMPLETED" }));
    const confirmAppointment = await loadConfirm();

    const result = await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });
    expect(result).toEqual({ ok: false, reason: "completed" });

    const { prisma } = await import("@/lib/prisma");
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(prisma.action.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(state.publishes).toHaveLength(0);
  });
});

describe("confirmAppointment — idempotency: alreadyConfirmed branch (S5)", () => {
  it("re-reads row, defensively closes actions, skips update/audit/events", async () => {
    state.rows.set(
      "apt_1",
      defaultRow({
        status: "CONFIRMED",
        queueStatus: "CONFIRMED",
        confirmedAt: new Date("2026-05-31T09:00:00.000Z"),
        confirmedBy: "user_first",
        confirmedVia: "SMS_REPLY",
      }),
    );

    const confirmAppointment = await loadConfirm();
    const result = await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyConfirmed).toBe(true);
    // Helper re-reads the row after the defensive close.
    expect(state.findUniqueCount).toBe(2);
    // The "fresh" row returned matches the second findUnique payload.
    expect(result.appointment.id).toBe("apt_1");
    expect(result.appointment.confirmedBy).toBe("user_first");
    expect(result.appointment.confirmedVia).toBe("SMS_REPLY");

    const { prisma } = await import("@/lib/prisma");
    // No double-write.
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    // No duplicate audit row.
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    // No duplicate realtime emit.
    expect(state.publishes).toHaveLength(0);
    // Defensive close STILL ran.
    expect(prisma.action.updateMany).toHaveBeenCalledTimes(1);
    expect(state.updateManyCalls[0]!.where.dedupeKey).toBe(
      "UNCONFIRMED_24H:appointmentId=apt_1",
    );
  });
});

describe("confirmAppointment — shouldFlipStatus matrix (S6)", () => {
  it("(a) status=BOOKED + queueStatus=BOOKED → flips BOTH columns, statusFlipped=true", async () => {
    state.rows.set(
      "apt_1",
      defaultRow({ status: "BOOKED", queueStatus: "BOOKED" }),
    );
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    const { prisma } = await import("@/lib/prisma");
    const updateArg = (prisma.appointment.update as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as {
      data: { status?: string; queueStatus?: string };
    };
    expect(updateArg.data.status).toBe("CONFIRMED");
    expect(updateArg.data.queueStatus).toBe("CONFIRMED");
    expect(state.audits[0]!.meta.statusFlipped).toBe(true);
  });

  it("(b) status=BOOKED + queueStatus=WAITING (drift) → leaves both alone, statusFlipped=false", async () => {
    // Why: the guard is AND-not-OR — one already-progressed column shouldn't
    // drag the other back. This covers a walk-in who texted YES after the
    // front desk already moved them to WAITING.
    state.rows.set(
      "apt_1",
      defaultRow({ status: "BOOKED", queueStatus: "WAITING" }),
    );
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "SMS_REPLY",
    });

    const { prisma } = await import("@/lib/prisma");
    const updateArg = (prisma.appointment.update as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as {
      data: { status?: string; queueStatus?: string };
    };
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.queueStatus).toBeUndefined();
    expect(state.audits[0]!.meta.statusFlipped).toBe(false);
  });

  it("(c) status=WAITING + queueStatus=WAITING → leaves both alone, statusFlipped=false", async () => {
    state.rows.set(
      "apt_1",
      defaultRow({ status: "WAITING", queueStatus: "WAITING" }),
    );
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "SMS_REPLY",
    });

    const { prisma } = await import("@/lib/prisma");
    const updateArg = (prisma.appointment.update as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as {
      data: { status?: string; queueStatus?: string };
    };
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.queueStatus).toBeUndefined();
    expect(state.audits[0]!.meta.statusFlipped).toBe(false);
  });
});

describe("confirmAppointment — closeOpenConfirmActions: dedupeKey matches detector (S7)", () => {
  it("uses the EXACT dedupeKeyFor stub that the detector would emit", async () => {
    state.rows.set("apt_1", defaultRow());
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    // The contract the helper's comment promises — verify it precisely.
    const expectedKey = dedupeKeyFor({
      type: "UNCONFIRMED_24H",
      appointmentId: "apt_1",
      patientId: "",
      patientName: "",
      appointmentAt: "",
      doctorName: "",
    });

    expect(state.updateManyCalls).toHaveLength(1);
    expect(state.updateManyCalls[0]!.where.dedupeKey).toBe(expectedKey);

    // And cross-check: a real detector emit (with realistic field values for
    // the not-part-of-key fields) yields the SAME key. If this ever diverges
    // the helper would silently fail to close detector-emitted rows.
    const detectorEmitKey = dedupeKeyFor({
      type: "UNCONFIRMED_24H",
      appointmentId: "apt_1",
      patientId: "p_real",
      patientName: "Иван Петров",
      appointmentAt: "2026-06-01T10:00:00.000Z",
      doctorName: "Иванов",
    });
    expect(detectorEmitKey).toBe(expectedKey);
  });
});

describe("confirmAppointment — closeOpenConfirmActions: where.status + data shape (S8)", () => {
  it("filters status IN [OPEN, SNOOZED] and writes status=DONE + doneAt Date", async () => {
    state.rows.set("apt_1", defaultRow());
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    expect(state.updateManyCalls).toHaveLength(1);
    const um = state.updateManyCalls[0]!;
    expect(um.where.status).toEqual({ in: ["OPEN", "SNOOZED"] });
    expect(um.data.status).toBe("DONE");
    expect(um.data.doneAt).toBeInstanceOf(Date);
  });
});

describe("confirmAppointment — actorId null path (S9)", () => {
  it("audit row carries actorId=null, actorRole=SYSTEM, actorLabel=confirm:<via>", async () => {
    state.rows.set("apt_1", defaultRow());
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: null,
      via: "TG_BUTTON",
    });

    expect(state.audits).toHaveLength(1);
    const audit = state.audits[0]!;
    expect(audit.actorId).toBeNull();
    expect(audit.actorRole).toBe("SYSTEM");
    expect(audit.actorLabel).toBe("confirm:TG_BUTTON");
  });
});

describe("confirmAppointment — actorId set path (S10)", () => {
  it("audit row carries actorId, actorRole=null, actorLabel=null", async () => {
    state.rows.set("apt_1", defaultRow());
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_123",
      via: "MANUAL_CRM",
    });

    expect(state.audits).toHaveLength(1);
    const audit = state.audits[0]!;
    expect(audit.actorId).toBe("user_123");
    expect(audit.actorRole).toBeNull();
    expect(audit.actorLabel).toBeNull();
  });
});

describe("confirmAppointment — realtime payload shape (S11)", () => {
  it("queue.updated + appointment.statusChanged carry previous from BEFORE snapshot", async () => {
    state.rows.set(
      "apt_1",
      defaultRow({ status: "BOOKED", queueStatus: "BOOKED", doctorId: "doc_9" }),
    );
    const confirmAppointment = await loadConfirm();
    await confirmAppointment({
      appointmentId: "apt_1",
      clinicId: "c1",
      actorId: "user_42",
      via: "MANUAL_CRM",
    });

    expect(state.publishes).toHaveLength(2);
    const [queueEv, statusEv] = state.publishes;

    expect(queueEv!.clinicId).toBe("c1");
    expect(queueEv!.event.type).toBe("queue.updated");
    expect(queueEv!.event.payload).toEqual({
      appointmentId: "apt_1",
      doctorId: "doc_9",
      queueStatus: "CONFIRMED",
      previousStatus: "BOOKED",
    });

    expect(statusEv!.clinicId).toBe("c1");
    expect(statusEv!.event.type).toBe("appointment.statusChanged");
    expect(statusEv!.event.payload).toEqual({
      appointmentId: "apt_1",
      doctorId: "doc_9",
      status: "CONFIRMED",
      previousStatus: "BOOKED",
    });
  });
});
