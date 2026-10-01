/**
 * Audit PT-10: closing a medical case ends its courses of medication.
 *
 * PATCH /api/crm/cases/[id] to RESOLVED / ABANDONED / TRANSFERRED only
 * stamped `closedAt`; the case's prescriptions stayed ACTIVE and the hourly
 * worker (which never looked at the case) kept sending «Пора принять
 * Карбамазепин» to a patient another doctor now treats.
 *
 * Acceptance: after a case is closed, none of its prescriptions gets into
 * the reminder tick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prescriptionStatusOnCaseClose } from "@/lib/cases/case-close";

type Rx = {
  id: string;
  caseId: string | null;
  status: string;
  remindersEnabled: boolean;
};

const state = vi.hoisted(() => ({
  role: "DOCTOR",
  caseStatus: "OPEN",
  rx: [] as Rx[],
  published: [] as Array<{ type: string; payload: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  sends: [] as string[],
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: "u1", role: state.role });
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
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: Request, input: Record<string, unknown>) => {
    state.audits.push(input);
  }),
}));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr-1",
  publishViaOutbox: vi.fn(async (_tx: unknown, env: { type: string; payload: Record<string, unknown> }) => {
    state.published.push({ type: env.type, payload: env.payload });
    return { eventId: "e" };
  }),
}));
vi.mock("@/server/queue", () => ({ getQueue: vi.fn() }));
vi.mock("@/server/notifications/template", () => ({ render: () => "text" }));
vi.mock("@/lib/patient-experience/medication-schedule", () => ({
  parseSchedule: () => ({ times: ["09:00"] }),
  isPrescriptionDueInWindow: () => ({ dueAt: new Date("2026-09-28T04:00:00Z") }),
  isCourseFinished: () => false,
}));
vi.mock("@/lib/prisma", () => {
  type Where = {
    id?: { in: string[] };
    caseId?: string;
    status?: string | { in: string[] };
    remindersEnabled?: boolean;
    OR?: Array<{ caseId?: null; case?: { status: string } }>;
  };
  const statusOk = (rx: Rx, s: Where["status"]) =>
    s === undefined || (typeof s === "string" ? rx.status === s : s.in.includes(rx.status));
  const matches = (rx: Rx, w: Where) =>
    (w.id === undefined || w.id.in.includes(rx.id)) &&
    (w.caseId === undefined || rx.caseId === w.caseId) &&
    statusOk(rx, w.status) &&
    (w.remindersEnabled === undefined || rx.remindersEnabled === w.remindersEnabled) &&
    (w.OR === undefined ||
      w.OR.some((o) =>
        "caseId" in o
          ? rx.caseId === null
          : rx.caseId !== null && state.caseStatus === o.case!.status,
      ));
  const prescription = {
    findMany: vi.fn(async ({ where }: { where: Where }) =>
      state.rx
        .filter((rx) => matches(rx, where))
        .map((rx) => ({
          ...rx,
          clinicId: "c1",
          patientId: "p1",
          drugName: "Карбамазепин",
          dosage: "200 мг",
          schedule: {},
          createdAt: new Date("2026-09-01T00:00:00Z"),
          patient: {
            fullName: "Пациент",
            phone: "+998901112233",
            telegramId: "1",
            preferredChannel: "TG",
            marketingOptOut: false,
            deletedAt: null,
          },
          clinic: {
            id: "c1",
            nameRu: "Клиника",
            nameUz: "Klinika",
            timezone: "Asia/Tashkent",
            medicationRemindersEnabled: true,
          },
        })),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: { status: string } }) => {
      let count = 0;
      for (const rx of state.rx) {
        if (matches(rx, where)) {
          rx.status = data.status;
          count += 1;
        }
      }
      return { count };
    }),
  };
  const caseRow = () => ({
    id: "case1",
    clinicId: "c1",
    patientId: "p1",
    title: "Эпилепсия",
    status: state.caseStatus,
    closedAt: null,
    closedReason: null,
    soapDraft: null,
  });
  const medicalCase = {
    findUnique: vi.fn(async () => caseRow()),
    update: vi.fn(async ({ data }: { data: { status?: string } }) => {
      if (data.status) state.caseStatus = data.status;
      return { ...caseRow(), ...data, patient: { id: "p1", fullName: "Пациент", phone: "+998" } };
    }),
  };
  const tx = { medicalCase, prescription };
  return {
    prisma: {
      ...tx,
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      notificationTemplate: { findMany: vi.fn(async () => []) },
      medicationReminderSend: {
        create: vi.fn(async ({ data }: { data: { prescriptionId: string } }) => {
          state.sends.push(data.prescriptionId);
          return { id: `s-${data.prescriptionId}` };
        }),
      },
    },
  };
});

const { PATCH } = await import("@/app/api/crm/cases/[id]/route");
const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");

function closeCase(status: string) {
  return PATCH(
    new Request("https://x/api/crm/cases/case1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, closedReason: "Передан другому врачу" }),
    }),
  );
}

beforeEach(() => {
  state.role = "DOCTOR";
  state.caseStatus = "OPEN";
  state.rx = [
    { id: "rx-active", caseId: "case1", status: "ACTIVE", remindersEnabled: true },
    { id: "rx-paused", caseId: "case1", status: "PAUSED", remindersEnabled: true },
    { id: "rx-done", caseId: "case1", status: "COMPLETED", remindersEnabled: true },
    // A course bridged from a signed visit has no case: never touched.
    { id: "rx-visit", caseId: null, status: "ACTIVE", remindersEnabled: true },
  ];
  state.published = [];
  state.audits = [];
  state.sends = [];
});

describe("the rule", () => {
  it("resolved: completed; abandoned or transferred: cancelled; reopening: nothing", () => {
    expect(prescriptionStatusOnCaseClose("RESOLVED")).toBe("COMPLETED");
    expect(prescriptionStatusOnCaseClose("ABANDONED")).toBe("CANCELLED");
    expect(prescriptionStatusOnCaseClose("TRANSFERRED")).toBe("CANCELLED");
    expect(prescriptionStatusOnCaseClose("OPEN")).toBeNull();
  });
});

describe("PATCH /api/crm/cases/[id] closing the case", () => {
  it("transferred: the running courses are cancelled and the Mini App is told", async () => {
    const res = await closeCase("TRANSFERRED");
    expect(res.status).toBe(200);
    expect(state.rx.map((r) => [r.id, r.status])).toEqual([
      ["rx-active", "CANCELLED"],
      ["rx-paused", "CANCELLED"],
      ["rx-done", "COMPLETED"],
      ["rx-visit", "ACTIVE"],
    ]);
    expect(state.published).toEqual([
      { type: "prescription.updated", payload: { prescriptionId: "rx-active", patientId: "p1", status: "CANCELLED" } },
      { type: "prescription.updated", payload: { prescriptionId: "rx-paused", patientId: "p1", status: "CANCELLED" } },
    ]);
    expect(state.audits[0]!.meta).toMatchObject({ endedPrescriptions: ["rx-active", "rx-paused"] });
  });

  it("resolved: the courses are completed", async () => {
    await closeCase("RESOLVED");
    expect(state.rx.find((r) => r.id === "rx-active")!.status).toBe("COMPLETED");
  });

  it("the front desk closing a case ends them the same way", async () => {
    state.role = "RECEPTIONIST";
    const res = await closeCase("ABANDONED");
    expect(res.status).toBe(200);
    expect(state.rx.find((r) => r.id === "rx-active")!.status).toBe("CANCELLED");
  });

  it("after closing, no course of the case gets into the reminder tick", async () => {
    await closeCase("TRANSFERRED");
    await runMedicationReminderTick(new Date("2026-09-28T04:00:00Z"));
    expect(state.sends).toEqual(["rx-visit"]);
  });
});

describe("the reminder tick on its own", () => {
  it("skips a course left ACTIVE on a case closed before the fix", async () => {
    state.caseStatus = "TRANSFERRED";
    await runMedicationReminderTick(new Date("2026-09-28T04:00:00Z"));
    expect(state.sends).toEqual(["rx-visit"]);
  });

  it("keeps reminding the courses of an open case", async () => {
    await runMedicationReminderTick(new Date("2026-09-28T04:00:00Z"));
    expect(state.sends).toEqual(["rx-active", "rx-visit"]);
  });
});

describe("scripts/fix-pt10-closed-case-prescriptions", () => {
  it("dry run lists, apply ends the courses of closed cases only", async () => {
    const { fixPt10ClosedCasePrescriptions } = await import(
      "../../scripts/fix-pt10-closed-case-prescriptions"
    );
    const rows = [
      { id: "rx1", status: "ACTIVE", drugName: "Карбамазепин", caseId: "k1", case: { status: "TRANSFERRED" }, patient: { patientNumber: 10 } },
      { id: "rx2", status: "PAUSED", drugName: "Вальпроат", caseId: "k2", case: { status: "RESOLVED" }, patient: { patientNumber: 11 } },
    ];
    const writes: Array<{ id: string; status: string }> = [];
    const db = {
      prescription: {
        findMany: vi.fn(async () => rows),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
          writes.push({ id: where.id, status: data.status });
          return { count: 1 };
        }),
      },
    };
    const lines: string[] = [];
    const dry = await fixPt10ClosedCasePrescriptions(db as never, false, (l) => lines.push(l));
    expect(dry).toEqual({ found: 2, written: 0 });
    expect(writes).toEqual([]);
    const applied = await fixPt10ClosedCasePrescriptions(db as never, true, () => {});
    expect(applied).toEqual({ found: 2, written: 2 });
    expect(writes).toEqual([
      { id: "rx1", status: "CANCELLED" },
      { id: "rx2", status: "COMPLETED" },
    ]);
    expect(db.prescription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["ACTIVE", "PAUSED"] }, case: { status: { not: "OPEN" } } },
      }),
    );
  });
});
