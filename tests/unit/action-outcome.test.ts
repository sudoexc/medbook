/**
 * POST /api/crm/actions/[id]/outcome — the six call outcomes each drive the
 * right durable write (TZ-risk-outcomes §4). Self-contained mocks (auth /
 * tenant / prisma / confirm / cancel) mirror the reorder + queue-status tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  clinicId: string;
  type: string;
  severity: string;
  status: string;
  payload: Record<string, unknown>;
  outcome: string | null;
  outcomeNote: string | null;
  callbackAt: Date | null;
  resolvedById: string | null;
  callAttempts: number;
  doneAt: Date | null;
  snoozeUntil: Date | null;
  expiresAt: Date | null;
};

const state = {
  row: null as Row | null,
  /** Rows written by `upsertAction` (the PATIENT_CALLBACK hand-off). */
  created: [] as Array<Record<string, unknown>>,
  confirmCalls: [] as unknown[],
  cancelCalls: [] as unknown[],
  audits: [] as Array<{ action: string; meta: unknown }>,
};

/** The visit the risk row is about: today, three hours from now. */
const APPT_AT = new Date(Date.now() + 3 * 60 * 60_000);

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_recept", role: "RECEPTIONIST", clinicId: "c1", email: "r@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_recept",
    role: "RECEPTIONIST" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, a: { action: string; meta: unknown }) => {
    state.audits.push({ action: a.action, meta: a.meta });
  }),
}));
vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(async (input: unknown) => {
    state.confirmCalls.push(input);
    return { ok: true, alreadyConfirmed: false };
  }),
}));
vi.mock("@/server/appointments/cancel", () => ({
  cancelAppointment: vi.fn(async (input: unknown) => {
    state.cancelCalls.push(input);
    return { ok: true, alreadyCancelled: false, lateCancelMinutes: 0 };
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async () => ({
        id: "ap_1",
        date: APPT_AT,
        patientId: "p_1",
        patient: { fullName: "Юсупова Лола" },
        doctor: { nameRu: "Султанов А." },
      })),
    },
    action: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) =>
        // By id: the row under test. By dedupe key: a callback task, if any.
        where.id ? state.row : (state.created[0] ?? null),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `act_cb_${state.created.length + 1}`, ...data };
        state.created.push(row);
        return row;
      }),
      update: vi.fn(
        async ({ data }: { data: Partial<Row> }) => {
          state.row = { ...(state.row as Row), ...data };
          return state.row;
        },
      ),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));

async function loadPOST() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/actions/[id]/outcome/route");
  return mod.POST as (req: Request) => Promise<Response>;
}

function postReq(body: unknown): Request {
  return new Request("https://x/api/crm/actions/act_1/outcome", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FUTURE = new Date(Date.now() + 3 * 60 * 60_000);

function seed(over: Partial<Row> = {}): Row {
  return {
    id: "act_1",
    clinicId: "c1",
    type: "NO_SHOW_RISK_HIGH",
    severity: "high",
    status: "OPEN",
    payload: { appointmentId: "ap_1", patientId: "p_1" },
    outcome: null,
    outcomeNote: null,
    callbackAt: null,
    resolvedById: null,
    callAttempts: 0,
    doneAt: null,
    snoozeUntil: null,
    expiresAt: FUTURE,
    ...over,
  };
}

beforeEach(() => {
  state.row = seed();
  state.created = [];
  state.confirmCalls = [];
  state.cancelCalls = [];
  state.audits = [];
});

describe("POST /api/crm/actions/[id]/outcome", () => {
  it("CONFIRMED → confirmAppointment + DONE(outcome)", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq({ outcome: "CONFIRMED" }));
    expect(res.status).toBe(200);
    expect(state.confirmCalls).toHaveLength(1);
    expect(state.confirmCalls[0]).toMatchObject({
      appointmentId: "ap_1",
      clinicId: "c1",
      actorId: "u_recept",
      via: "INBOUND_CALL",
    });
    expect(state.row!.status).toBe("DONE");
    expect(state.row!.outcome).toBe("CONFIRMED");
    expect(state.row!.resolvedById).toBe("u_recept");
  });

  it("REFUSED → cancelAppointment(reason=note) + DONE", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq({ outcome: "REFUSED", note: "передумал" }));
    expect(res.status).toBe(200);
    expect(state.cancelCalls).toHaveLength(1);
    expect(state.cancelCalls[0]).toMatchObject({
      appointmentId: "ap_1",
      reason: "передумал",
    });
    expect(state.row!.status).toBe("DONE");
    expect(state.row!.outcome).toBe("REFUSED");
  });

  it("RESCHEDULED → DONE, no confirm/cancel", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq({ outcome: "RESCHEDULED" }));
    expect(res.status).toBe(200);
    expect(state.confirmCalls).toHaveLength(0);
    expect(state.cancelCalls).toHaveLength(0);
    expect(state.row!.status).toBe("DONE");
    expect(state.row!.outcome).toBe("RESCHEDULED");
  });

  it("CALLBACK before the visit → SNOOZED until callbackAt with note", async () => {
    const POST = await loadPOST();
    const when = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const res = await POST(
      postReq({ outcome: "CALLBACK", callbackAt: when, note: "занят" }),
    );
    expect(res.status).toBe(200);
    expect(state.row!.status).toBe("SNOOZED");
    expect(state.row!.snoozeUntil?.toISOString()).toBe(when);
    expect(state.row!.callbackAt?.toISOString()).toBe(when);
    expect(state.row!.outcomeNote).toBe("занят");
    expect(state.created).toHaveLength(0);
  });

  // Audit AC-09: the risk row expires with the visit, so a later call moves
  // to a task of its own.
  it("CALLBACK after the visit → the row is DONE and a PATIENT_CALLBACK task waits for the time", async () => {
    const POST = await loadPOST();
    const when = new Date(APPT_AT.getTime() + 20 * 60 * 60_000);
    const res = await POST(
      postReq({ outcome: "CALLBACK", callbackAt: when.toISOString(), note: "на работе" }),
    );
    expect(res.status).toBe(200);
    expect(state.cancelCalls).toHaveLength(0);
    expect(state.row).toMatchObject({ status: "DONE", outcome: "CALLBACK" });
    expect(state.created).toEqual([
      expect.objectContaining({
        type: "PATIENT_CALLBACK",
        status: "SNOOZED",
        snoozeUntil: when,
        expiresAt: null,
        payload: expect.objectContaining({ reason: "CALLBACK", note: "на работе" }),
      }),
    ]);
  });

  it("CALLBACK without callbackAt → 400 (schema)", async () => {
    const POST = await loadPOST();
    const res = await POST(postReq({ outcome: "CALLBACK" }));
    expect(res.status).toBe(400);
  });

  // Audit AC-09: «хочет прийти позже» frees today's slot and schedules the
  // call for 09:00 of the return day.
  it("RETURN_LATER → cancels the visit, closes the row, schedules the call on the return day", async () => {
    const POST = await loadPOST();
    const when = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const res = await POST(
      postReq({ outcome: "RETURN_LATER", callbackAt: when.toISOString(), note: "после отпуска" }),
    );
    expect(res.status).toBe(200);
    expect(state.cancelCalls).toEqual([
      expect.objectContaining({ appointmentId: "ap_1", reason: "после отпуска" }),
    ]);
    expect(state.row!.status).toBe("DONE");
    const [task] = state.created;
    expect(task).toMatchObject({ type: "PATIENT_CALLBACK", status: "SNOOZED" });
    const at = task!.snoozeUntil as Date;
    // 09:00 Tashkent (04:00Z) on the picked day.
    expect(at.toISOString().slice(11)).toBe("04:00:00.000Z");
    expect(at.getTime() - when.getTime()).toBeLessThan(24 * 60 * 60_000);
  });

  it("RETURN_LATER on the visit's own day → 409, nothing written", async () => {
    const POST = await loadPOST();
    const res = await POST(
      postReq({ outcome: "RETURN_LATER", callbackAt: APPT_AT.toISOString() }),
    );
    expect(res.status).toBe(409);
    expect(state.cancelCalls).toHaveLength(0);
    expect(state.row!.status).toBe("OPEN");
    expect(state.created).toHaveLength(0);
  });

  it("NO_ANSWER → attempts++ + SNOOZED; escalates severity at the cap", async () => {
    // First two attempts stay 'high' severity's input; third hits the cap.
    state.row = seed({ callAttempts: 2, severity: "medium" });
    const POST = await loadPOST();
    const res = await POST(postReq({ outcome: "NO_ANSWER" }));
    expect(res.status).toBe(200);
    expect(state.row!.callAttempts).toBe(3);
    expect(state.row!.status).toBe("SNOOZED");
    expect(state.row!.snoozeUntil).toBeInstanceOf(Date);
    expect(state.row!.severity).toBe("high");
  });
});
