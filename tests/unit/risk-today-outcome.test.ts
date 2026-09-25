/**
 * Audit AC-04 — a risk-today row whose only reason is «не на связи» has no
 * detector Action. The client used to loop over the row's Action ids, so for
 * such a row no outcome reached the server: «Отказался» left the visit
 * BOOKED, «Подтвердил» confirmed nothing, and mark-contacted ran for every
 * outcome, «Не дозвонился» included, hiding the row for two weeks.
 *
 * `POST /api/crm/action-center/risk-today/outcome` now resolves the row by
 * appointment. These tests drive it and the risk-today GET against one
 * in-memory clinic, so «строка возвращается позже» and «исход виден в
 * Обработано сегодня» are checked end to end.
 *
 * Review of that fix: the endpoint takes a bare appointment id, so it must
 * accept exactly the rows the risk-today list can show (today's clinic day,
 * a visit still ahead or under way) and only the roles of the canonical
 * cancel. Otherwise a DOCTOR could cancel another doctor's visit next week,
 * and any id opened a call task and marked the patient «на связи».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RISK_ACTION_TYPES,
  RISK_TODAY_APPOINTMENT_STATUSES,
} from "@/lib/actions/types";
import { canTransition } from "@/lib/appointment-transitions";

type Appt = {
  id: string;
  clinicId: string;
  date: Date;
  status: string;
  priceFinal: number | null;
  patientId: string;
  confirmedAt: Date | null;
  cancelReason: string | null;
};
type Patient = {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string;
  lastContactedAt: Date | null;
};
type ActionRow = Record<string, unknown> & { id: string };

const db = {
  role: "RECEPTIONIST" as "RECEPTIONIST" | "ADMIN" | "DOCTOR",
  appts: new Map<string, Appt>(),
  patients: new Map<string, Patient>(),
  actions: new Map<string, ActionRow>(),
  audits: [] as Array<{ action: string; meta: Record<string, unknown> }>,
  confirmCalls: [] as Array<Record<string, unknown>>,
  cancelCalls: [] as Array<Record<string, unknown>>,
  seq: 0,
};

/** Prisma where-subset used by the code under test. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Array<Record<string, unknown>>).some((w) => matches(row, w));
    const v = row[key];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date || typeof cond !== "object") {
      return v instanceof Date && cond instanceof Date
        ? v.getTime() === cond.getTime()
        : v === cond;
    }
    const c = cond as { in?: unknown[]; gte?: Date; lt?: Date; lte?: Date };
    if (c.in) return c.in.includes(v);
    const t = v instanceof Date ? v.getTime() : NaN;
    if (c.gte && !(t >= c.gte.getTime())) return false;
    if (c.lt && !(t < c.lt.getTime())) return false;
    if (c.lte && !(t <= c.lte.getTime())) return false;
    return true;
  });
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_recept", role: db.role, clinicId: "c1", email: "r@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_recept",
    role: db.role,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, a: { action: string; meta: Record<string, unknown> }) => {
    db.audits.push({ action: a.action, meta: a.meta });
  }),
}));
// The real confirm / cancel fan out to notifications and realtime; their own
// suites cover that. Here they record the call and flip the row the way the
// real ones do, so the acceptance reads off the appointment itself.
vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(async (input: { appointmentId: string }) => {
    db.confirmCalls.push(input);
    const a = db.appts.get(input.appointmentId);
    if (!a) return { ok: false, reason: "not_found" };
    if (a.status === "CANCELLED" || a.status === "NO_SHOW") {
      return { ok: false, reason: "cancelled" };
    }
    a.confirmedAt = new Date();
    a.status = "CONFIRMED";
    return { ok: true, appointment: a, alreadyConfirmed: false };
  }),
}));
vi.mock("@/server/appointments/cancel", () => ({
  cancelAppointment: vi.fn(async (input: { appointmentId: string; reason?: string }) => {
    db.cancelCalls.push(input);
    const a = db.appts.get(input.appointmentId);
    if (!a) return { ok: false, reason: "not_found" };
    a.status = "CANCELLED";
    a.cancelReason = input.reason ?? null;
    return { ok: true, appointment: a, alreadyCancelled: false, lateCancelMinutes: 0 };
  }),
}));

vi.mock("@/lib/prisma", () => {
  const apptShape = (a: Appt) => {
    const p = db.patients.get(a.patientId)!;
    return {
      id: a.id,
      clinicId: a.clinicId,
      date: a.date,
      status: a.status,
      priceFinal: a.priceFinal,
      patientId: a.patientId,
      patient: {
        id: p.id,
        fullName: p.fullName,
        phone: p.phone,
        lastContactedAt: p.lastContactedAt,
      },
      doctor: { id: "doc_1", nameRu: "Алиев А.А.", nameUz: "Aliyev A.A." },
      primaryService: null,
    };
  };
  const actionByUnique = (where: Record<string, unknown>) => {
    if (typeof where.id === "string") return db.actions.get(where.id) ?? null;
    const k = where.clinicId_dedupeKey as { clinicId: string; dedupeKey: string };
    return (
      [...db.actions.values()].find(
        (r) => r.clinicId === k.clinicId && r.dedupeKey === k.dedupeKey,
      ) ?? null
    );
  };
  return {
    prisma: {
      clinic: { findUnique: vi.fn(async () => ({ timezone: "Asia/Tashkent" })) },
      appointment: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const a = db.appts.get(where.id);
          return a ? apptShape(a) : null;
        }),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          [...db.appts.values()]
            .filter((a) => matches(a as never, where))
            .sort((x, y) => x.date.getTime() - y.date.getTime())
            .map(apptShape),
        ),
      },
      patient: {
        updateMany: vi.fn(
          async ({ where, data }: { where: Record<string, unknown>; data: Partial<Patient> }) => {
            const p = db.patients.get(where.id as string);
            const or = where.OR as Array<Record<string, unknown>>;
            const fresh =
              p &&
              or.some((w) =>
                w.lastContactedAt === null
                  ? p.lastContactedAt === null
                  : p.lastContactedAt !== null &&
                    p.lastContactedAt.getTime() <
                      (w.lastContactedAt as { lt: Date }).lt.getTime(),
              );
            if (fresh) Object.assign(p!, data);
            return { count: fresh ? 1 : 0 };
          },
        ),
      },
      action: {
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          actionByUnique(where),
        ),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          [...db.actions.values()].filter((r) => matches(r, where)),
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `act_${++db.seq}`,
            snoozeUntil: null,
            doneAt: null,
            dismissedAt: null,
            outcome: null,
            outcomeNote: null,
            callbackAt: null,
            resolvedById: null,
            callAttempts: 0,
            createdAt: new Date(),
            ...data,
            updatedAt: new Date(),
          };
          db.actions.set(row.id, row);
          return row;
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = { ...db.actions.get(where.id)!, ...data, updatedAt: new Date() };
            db.actions.set(where.id, row);
            return row;
          },
        ),
      },
      auditLog: { create: vi.fn(async () => ({})) },
      notificationSend: { groupBy: vi.fn(async () => []) },
      user: {
        findMany: vi.fn(async () => [{ id: "u_recept", name: "Регистратор" }]),
      },
    },
  };
});

// 25 Sep 2026, 11:00 Tashkent.
const NOW = new Date("2026-09-25T06:00:00.000Z");
const APPT_AT = new Date("2026-09-25T10:00:00.000Z"); // 15:00 Tashkent
const LAST_CONTACT = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

function seedNoContactRow() {
  db.patients.set("p_1", {
    id: "p_1",
    clinicId: "c1",
    fullName: "Каримова Нодира",
    phone: "+998901112233",
    lastContactedAt: LAST_CONTACT,
  });
  // Confirmed at booking, so no UNCONFIRMED_24H; low no-show risk, so no
  // NO_SHOW_RISK_HIGH. The row exists only because of the 30-day silence.
  db.appts.set("ap_1", {
    id: "ap_1",
    clinicId: "c1",
    date: APPT_AT,
    status: "CONFIRMED",
    priceFinal: 20_000_000,
    patientId: "p_1",
    confirmedAt: null,
    cancelReason: null,
  });
}

async function routes() {
  vi.resetModules();
  const outcome = await import("@/app/api/crm/action-center/risk-today/outcome/route");
  const list = await import("@/app/api/crm/action-center/risk-today/route");
  return {
    post: outcome.POST as (req: Request) => Promise<Response>,
    get: list.GET as (req: Request) => Promise<Response>,
  };
}

function postOutcome(body: Record<string, unknown>): Request {
  return new Request("https://x/api/crm/action-center/risk-today/outcome", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appointmentId: "ap_1", ...body }),
  });
}

async function riskToday(get: (req: Request) => Promise<Response>) {
  const res = await get(new Request("https://x/api/crm/action-center/risk-today"));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    appointments: Array<{
      appointmentId: string;
      actionIds: string[];
      reasons: Array<{ kind: string; daysSinceContact?: number | null }>;
    }>;
    handled: Array<{ appointmentId: string; outcome: string; outcomeNote: string | null }>;
  };
}

beforeEach(() => {
  db.role = "RECEPTIONIST";
  db.appts.clear();
  db.patients.clear();
  db.actions.clear();
  db.audits = [];
  db.confirmCalls = [];
  db.cancelCalls = [];
  db.seq = 0;
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  seedNoContactRow();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("risk-today outcome for a «не на связи»-only row", () => {
  it("starts as a row with no Action attached", async () => {
    const { get } = await routes();
    const data = await riskToday(get);
    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0]!.actionIds).toEqual([]);
    expect(data.appointments[0]!.reasons).toEqual([
      { kind: "no_contact", daysSinceContact: 30 },
    ]);
  });

  it("«Отказался» with a reason cancels the visit and lands in «Обработано сегодня»", async () => {
    const { post, get } = await routes();
    const res = await post(postOutcome({ outcome: "REFUSED", note: "уехала в Самарканд" }));
    expect(res.status).toBe(200);

    expect(db.cancelCalls).toHaveLength(1);
    expect(db.appts.get("ap_1")).toMatchObject({
      status: "CANCELLED",
      cancelReason: "уехала в Самарканд",
    });
    // The patient did talk to us.
    expect(db.patients.get("p_1")!.lastContactedAt).toEqual(NOW);

    const data = await riskToday(get);
    expect(data.appointments).toHaveLength(0);
    expect(data.handled).toEqual([
      expect.objectContaining({
        appointmentId: "ap_1",
        outcome: "REFUSED",
        outcomeNote: "уехала в Самарканд",
      }),
    ]);
  });

  it("«Подтвердил» confirms the visit", async () => {
    db.appts.get("ap_1")!.status = "BOOKED";
    const { post, get } = await routes();
    const res = await post(postOutcome({ outcome: "CONFIRMED" }));
    expect(res.status).toBe(200);
    expect(db.confirmCalls).toEqual([
      expect.objectContaining({ appointmentId: "ap_1", via: "INBOUND_CALL" }),
    ]);
    expect(db.appts.get("ap_1")!.confirmedAt).toBeInstanceOf(Date);

    const data = await riskToday(get);
    expect(data.appointments).toHaveLength(0);
    expect(data.handled.map((h) => h.outcome)).toEqual(["CONFIRMED"]);
  });

  it("«Не дозвонился» keeps lastContactedAt, hides the row, and brings it back later", async () => {
    const { post, get } = await routes();
    const res = await post(postOutcome({ outcome: "NO_ANSWER" }));
    expect(res.status).toBe(200);

    expect(db.patients.get("p_1")!.lastContactedAt).toEqual(LAST_CONTACT);
    expect(db.audits.map((a) => a.action)).not.toContain("patient.contact_marked");
    const [task] = [...db.actions.values()];
    expect(task).toMatchObject({
      type: "NO_CONTACT_CALL",
      status: "SNOOZED",
      outcome: "NO_ANSWER",
      callAttempts: 1,
    });

    // Right after the call: off the list, but in the handled trail.
    let data = await riskToday(get);
    expect(data.appointments).toHaveLength(0);
    expect(data.handled.map((h) => h.outcome)).toEqual(["NO_ANSWER"]);

    // Two hours later the row is back, now carrying the call task.
    vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000 + 60_000));
    data = await riskToday(get);
    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0]!.actionIds).toEqual([task!.id]);
    expect(data.appointments[0]!.reasons[0]!.kind).toBe("no_contact");

    // A second «не дозвонился» reuses the same task instead of a new one.
    await post(postOutcome({ outcome: "NO_ANSWER" }));
    expect(db.actions.size).toBe(1);
    expect(db.actions.get(task!.id)!.callAttempts).toBe(2);
  });

  it("«Перезвонить позже» talks to the patient yet brings the row back at the callback time", async () => {
    const { post, get } = await routes();
    const callbackAt = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    const res = await post(
      postOutcome({ outcome: "CALLBACK", callbackAt: callbackAt.toISOString(), note: "за рулём" }),
    );
    expect(res.status).toBe(200);
    expect(db.patients.get("p_1")!.lastContactedAt).toEqual(NOW);

    expect((await riskToday(get)).appointments).toHaveLength(0);

    vi.setSystemTime(new Date(callbackAt.getTime() + 60_000));
    const data = await riskToday(get);
    expect(data.appointments).toHaveLength(1);
    // Labelled with why it was put on the list in the first place.
    expect(data.appointments[0]!.reasons).toEqual([
      { kind: "no_contact", daysSinceContact: 30 },
    ]);
  });

  it("refuses an outcome the appointment can no longer take, recording nothing", async () => {
    const { post } = await routes();
    // Someone cancelled the visit a moment after the eligibility read.
    const { confirmAppointment } = await import("@/server/appointments/confirm");
    vi.mocked(confirmAppointment).mockResolvedValueOnce({
      ok: false,
      reason: "cancelled",
    } as never);
    const res = await post(postOutcome({ outcome: "CONFIRMED" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("cancelled");
    expect(db.actions.size).toBe(0);
    expect(db.patients.get("p_1")!.lastContactedAt).toEqual(LAST_CONTACT);
  });

  it("404s for an appointment of another clinic", async () => {
    db.appts.get("ap_1")!.clinicId = "c_other";
    const { post } = await routes();
    const res = await post(postOutcome({ outcome: "REFUSED", note: "x" }));
    expect(res.status).toBe(404);
    expect(db.cancelCalls).toHaveLength(0);
  });
});

describe("only a risk-today row takes an outcome", () => {
  async function refused(body: Record<string, unknown>) {
    const { post } = await routes();
    const res = await post(postOutcome(body));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("not_risk_today");
    // Nothing happened: no side effect, no task, no contact stamp.
    expect(db.cancelCalls).toHaveLength(0);
    expect(db.confirmCalls).toHaveLength(0);
    expect(db.actions.size).toBe(0);
    expect(db.patients.get("p_1")!.lastContactedAt).toEqual(LAST_CONTACT);
    expect(db.audits).toHaveLength(0);
  }

  it("does not cancel a visit next week", async () => {
    Object.assign(db.appts.get("ap_1")!, {
      status: "CONFIRMED",
      date: new Date(APPT_AT.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await refused({ outcome: "REFUSED", note: "x" });
    expect(db.appts.get("ap_1")!.status).toBe("CONFIRMED");
  });

  it("opens no call task for yesterday's visit", async () => {
    db.appts.get("ap_1")!.date = new Date(APPT_AT.getTime() - 24 * 60 * 60 * 1000);
    await refused({ outcome: "NO_ANSWER" });
  });

  it("does not mark the patient contacted through tomorrow's visit", async () => {
    db.appts.get("ap_1")!.date = new Date(APPT_AT.getTime() + 24 * 60 * 60 * 1000);
    await refused({
      outcome: "CALLBACK",
      callbackAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    });
  });

  it("refuses a visit of today that is already over, which the client shows as stale", async () => {
    for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW", "SKIPPED"]) {
      db.appts.get("ap_1")!.status = status;
      await refused({ outcome: "CONFIRMED" });
    }
    const { STALE_APPOINTMENT_REASONS } = await import(
      "@/app/[locale]/crm/action-center/_hooks/use-risk-today"
    );
    expect(STALE_APPOINTMENT_REASONS).toContain("not_risk_today");
  });

  it("reads «today» on the clinic clock, like the list", async () => {
    // 23:30 Tashkent on 25 Sep is still today (18:30Z).
    db.appts.get("ap_1")!.date = new Date("2026-09-25T18:30:00.000Z");
    const { post } = await routes();
    expect((await post(postOutcome({ outcome: "NO_ANSWER" }))).status).toBe(200);

    // 00:30 Tashkent on 26 Sep is tomorrow, although still 25 Sep in UTC.
    db.actions.clear();
    db.appts.get("ap_1")!.date = new Date("2026-09-25T19:30:00.000Z");
    const res = await post(postOutcome({ outcome: "NO_ANSWER" }));
    expect(res.status).toBe(409);
  });

  it("every status the list shows can still be cancelled by «Отказался»", () => {
    for (const status of RISK_TODAY_APPOINTMENT_STATUSES) {
      expect(canTransition(status, "CANCELLED"), status).toBe(true);
    }
  });

  it("is closed to doctors, like the canonical cancel", async () => {
    db.role = "DOCTOR";
    const { post } = await routes();
    const res = await post(postOutcome({ outcome: "REFUSED", note: "x" }));
    expect(res.status).toBe(403);
    expect(db.cancelCalls).toHaveLength(0);
    expect(db.appts.get("ap_1")!.status).toBe("CONFIRMED");
  });

  it("stays open to reception and admins", async () => {
    db.role = "ADMIN";
    const { post } = await routes();
    expect((await post(postOutcome({ outcome: "CONFIRMED" }))).status).toBe(200);
  });
});

describe("a snoozing outcome brings the task back at the top of the list", () => {
  it("stamps surfacedAt with the moment the row returns", async () => {
    const { post } = await routes();
    await post(postOutcome({ outcome: "NO_ANSWER" }));
    const [task] = [...db.actions.values()];
    expect(task!.surfacedAt).toEqual(new Date(NOW.getTime() + 2 * 60 * 60 * 1000));

    const callbackAt = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
    await post(
      postOutcome({ outcome: "CALLBACK", callbackAt: callbackAt.toISOString() }),
    );
    expect(db.actions.get(task!.id)!.surfacedAt).toEqual(callbackAt);
  });
});

describe("risk-today outcome for a row with detector Actions", () => {
  function seedDetector(type: "UNCONFIRMED_24H" | "NO_SHOW_RISK_HIGH", id: string) {
    db.actions.set(id, {
      id,
      clinicId: "c1",
      type,
      severity: "medium",
      status: "OPEN",
      payload: { type, appointmentId: "ap_1", patientId: "p_1" },
      dedupeKey: `${type}:appointmentId=ap_1`,
      snoozeUntil: null,
      doneAt: null,
      expiresAt: null,
      outcome: null,
      outcomeNote: null,
      callbackAt: null,
      resolvedById: null,
      callAttempts: 0,
      updatedAt: NOW,
    });
  }

  it("stamps every attached Action, cancels once, and creates no call task", async () => {
    db.appts.get("ap_1")!.status = "BOOKED";
    seedDetector("UNCONFIRMED_24H", "act_u");
    seedDetector("NO_SHOW_RISK_HIGH", "act_n");
    const { post } = await routes();
    const res = await post(postOutcome({ outcome: "REFUSED", note: "передумала" }));
    expect(res.status).toBe(200);
    expect(db.cancelCalls).toHaveLength(1);
    expect(db.actions.size).toBe(2);
    for (const id of ["act_u", "act_n"]) {
      expect(db.actions.get(id)).toMatchObject({ status: "DONE", outcome: "REFUSED" });
    }
  });

  it("«Не дозвонился» on a row that is also «не на связи» hides it until the snooze ends", async () => {
    db.appts.get("ap_1")!.status = "BOOKED";
    seedDetector("UNCONFIRMED_24H", "act_u");
    const { post, get } = await routes();
    expect((await riskToday(get)).appointments[0]!.reasons.map((r) => r.kind)).toEqual([
      "unconfirmed_24h",
      "no_contact",
    ]);

    await post(postOutcome({ outcome: "NO_ANSWER" }));
    expect(db.patients.get("p_1")!.lastContactedAt).toEqual(LAST_CONTACT);
    // Previously the no-contact chip alone brought the row straight back.
    expect((await riskToday(get)).appointments).toHaveLength(0);

    vi.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 60 * 1000 + 60_000));
    const back = await riskToday(get);
    expect(back.appointments[0]!.actionIds).toEqual(["act_u"]);
  });
});

describe("risk action bookkeeping", () => {
  it("looks up every risk Action type of an appointment", async () => {
    const { riskDedupeKeys } = await import("@/server/actions/risk-outcome");
    const keys = riskDedupeKeys("ap_7");
    expect(keys).toHaveLength(RISK_ACTION_TYPES.length);
    for (const type of RISK_ACTION_TYPES) {
      expect(keys).toContain(`${type}:appointmentId=ap_7`);
    }
  });

  it("the risk-today widget posts one outcome per appointment, not per Action", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/crm/action-center/_hooks/use-risk-today.ts",
      ),
      "utf8",
    );
    expect(src).toContain("/api/crm/action-center/risk-today/outcome");
    expect(src).not.toContain("/api/crm/actions/${id}/outcome");
    expect(src).not.toContain("mark-contacted");
  });
});
