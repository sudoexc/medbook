/**
 * The Action Center work list end to end, against one in-memory clinic:
 * the risk-today outcome endpoint, the list endpoint, the KPI summary and
 * the engine's expiry sweep.
 *
 * Audit AC-09 — «Перезвонить позже» / «Хочет прийти позже» only snoozed the
 * visit's risk rows, and those die with the visit: NO_SHOW_RISK_HIGH expires
 * at the visit time, NO_CONTACT_CALL at the end of its day, and the sweep
 * expired the snoozed row before its timer ran out. The promised call never
 * came back, and «хочет прийти 10 октября» left today's visit BOOKED until it
 * turned into a NO_SHOW. Acceptance: «Хочет прийти позже» on 10.10 cancels
 * today's visit and on 10.10 the Action Center shows a call task with the
 * note; «Перезвонить» tomorrow 11:00 shows the task tomorrow at 11:00.
 *
 * Audit AC-18 — the center loaded one page of 50 and computed every KPI from
 * it. Acceptance: with 200 open tasks the first page holds every critical
 * task before any high one, paging reaches every task exactly once, and the
 * KPI summary equals the aggregate over the whole table.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_SEVERITIES, SEVERITY_RANK, type ActionSeverity } from "@/lib/actions/types";

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
type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

const db = {
  appts: new Map<string, Appt>(),
  patients: new Map<string, Patient>(),
  actions: new Map<string, Row>(),
  cancelCalls: [] as Array<{ appointmentId: string; reason?: string }>,
  seq: 0,
};

function cmp(v: unknown, c: unknown): number {
  const a = v instanceof Date ? v.getTime() : (v as number);
  const b = c instanceof Date ? c.getTime() : (c as number);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Evaluates the Prisma `where` subset these routes use, like Postgres would. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Where[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Where[]).some((w) => matches(row, w));
    const v = row[key];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond !== "object") return v === cond;
    const c = cond as Record<string, unknown>;
    if (c.in && !(c.in as unknown[]).includes(v)) return false;
    if (c.notIn && (c.notIn as unknown[]).includes(v)) return false;
    if ("not" in c && (c.not === null ? v == null : v === c.not)) return false;
    const has = (k: string) => c[k] !== undefined;
    if ((has("lt") || has("lte") || has("gt") || has("gte")) && v == null) return false;
    if (has("lt") && !(cmp(v, c.lt) < 0)) return false;
    if (has("lte") && !(cmp(v, c.lte) <= 0)) return false;
    if (has("gt") && !(cmp(v, c.gt) > 0)) return false;
    if (has("gte") && !(cmp(v, c.gte) >= 0)) return false;
    return true;
  });
}

function sortBy<T extends Record<string, unknown>>(
  rows: T[],
  orderBy: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">> | undefined,
): T[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((o) => Object.entries(o)[0]!);
  return [...rows].sort((x, y) => {
    for (const [k, dir] of keys) {
      const a = x[k];
      const b = y[k];
      const d =
        typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : cmp(a, b);
      if (d !== 0) return dir === "asc" ? d : -d;
    }
    return 0;
  });
}

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
    role: "RECEPTIONIST",
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/appointments/confirm", () => ({
  confirmAppointment: vi.fn(async () => ({ ok: true, alreadyConfirmed: false })),
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
      ...a,
      patient: { id: p.id, fullName: p.fullName, phone: p.phone, lastContactedAt: p.lastContactedAt },
      doctor: { id: "doc_1", nameRu: "Султанов А.", nameUz: "Sultanov A." },
      primaryService: null,
    };
  };
  const actionByUnique = (where: Where) => {
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
        findMany: vi.fn(
          async ({ where, orderBy }: { where: Where; orderBy?: Record<string, "asc" | "desc"> }) =>
            sortBy(
              [...db.appts.values()].filter((a) => matches(a as never, where)),
              orderBy,
            ).map(apptShape),
        ),
      },
      patient: {
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<Patient> }) => {
          const p = db.patients.get(where.id as string);
          if (p) Object.assign(p, data);
          return { count: p ? 1 : 0 };
        }),
      },
      action: {
        findUnique: vi.fn(async ({ where }: { where: Where }) => actionByUnique(where)),
        findMany: vi.fn(
          async ({
            where,
            orderBy,
            take,
          }: {
            where: Where;
            orderBy?: Array<Record<string, "asc" | "desc">>;
            take?: number;
          }) => {
            const rows = sortBy(
              [...db.actions.values()].filter((r) => matches(r, where)),
              orderBy,
            );
            return take === undefined ? rows : rows.slice(0, take);
          },
        ),
        groupBy: vi.fn(async ({ by, where }: { by: string[]; where: Where }) => {
          const groups = new Map<string, Record<string, unknown>>();
          for (const r of db.actions.values()) {
            if (!matches(r, where)) continue;
            const key = by.map((k) => String(r[k])).join("|");
            const g = groups.get(key) ?? {
              ...Object.fromEntries(by.map((k) => [k, r[k]])),
              _count: { _all: 0 },
            };
            (g._count as { _all: number })._all += 1;
            groups.set(key, g);
          }
          return [...groups.values()];
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: `act_${String(++db.seq).padStart(4, "0")}`,
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
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = { ...db.actions.get(where.id)!, ...data, updatedAt: new Date() };
          db.actions.set(where.id, row);
          return row;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
          let count = 0;
          for (const r of db.actions.values()) {
            if (!matches(r, where)) continue;
            db.actions.set(r.id, { ...r, ...data, updatedAt: new Date() });
            count += 1;
          }
          return { count };
        }),
      },
      auditLog: { create: vi.fn(async () => ({})) },
      notificationSend: { groupBy: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => [{ id: "u_recept", name: "Регистратор" }]) },
    },
  };
});

// 25 Sep 2026, 11:00 Tashkent; Aziz's patient is booked for 15:00.
const NOW = new Date("2026-09-25T06:00:00.000Z");
const APPT_AT = new Date("2026-09-25T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function routes() {
  vi.resetModules();
  const outcome = await import("@/app/api/crm/action-center/risk-today/outcome/route");
  const riskToday = await import("@/app/api/crm/action-center/risk-today/route");
  const list = await import("@/app/api/crm/actions/route");
  const summary = await import("@/app/api/crm/actions/summary/route");
  const { expireStaleActions } = await import("@/server/actions/repository");
  const { prisma } = await import("@/lib/prisma");
  return {
    post: outcome.POST as (req: Request) => Promise<Response>,
    riskToday: riskToday.GET as (req: Request) => Promise<Response>,
    list: list.GET as (req: Request) => Promise<Response>,
    summary: summary.GET as (req: Request) => Promise<Response>,
    /** One pass of the engine's expiry sweep, as the 15-minute tick runs it. */
    sweep: () => expireStaleActions(prisma as never, "c1", 48),
  };
}

type ListRow = { id: string; type: string; severity: string; payload: Record<string, unknown> };

async function listPage(
  list: (req: Request) => Promise<Response>,
  params = "status=OPEN&status=SNOOZED&limit=50",
) {
  const res = await list(new Request(`https://x/api/crm/actions?${params}`));
  expect(res.status).toBe(200);
  return (await res.json()) as { rows: ListRow[]; nextCursor: string | null };
}

function postOutcome(body: Record<string, unknown>): Request {
  return new Request("https://x/api/crm/action-center/risk-today/outcome", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appointmentId: "ap_1", ...body }),
  });
}

/** The NO_SHOW_RISK_HIGH row the engine raised for the 15:00 visit. */
function seedRiskRow() {
  db.actions.set("risk_1", {
    id: "risk_1",
    clinicId: "c1",
    type: "NO_SHOW_RISK_HIGH",
    severity: "medium",
    status: "OPEN",
    payload: {
      type: "NO_SHOW_RISK_HIGH",
      appointmentId: "ap_1",
      patientId: "p_1",
      patientName: "Юсупова Лола",
      risk: 0.67,
      appointmentAt: APPT_AT.toISOString(),
    },
    dedupeKey: "NO_SHOW_RISK_HIGH:appointmentId=ap_1",
    assigneeRole: "RECEPTIONIST",
    deeplinkPath: "/crm/appointments",
    snoozeUntil: null,
    doneAt: null,
    dismissedAt: null,
    expiresAt: APPT_AT,
    outcome: null,
    outcomeNote: null,
    callbackAt: null,
    resolvedById: null,
    callAttempts: 0,
    createdAt: new Date(NOW.getTime() - HOUR),
    surfacedAt: new Date(NOW.getTime() - HOUR),
    updatedAt: new Date(NOW.getTime() - HOUR),
  });
}

beforeEach(() => {
  db.appts.clear();
  db.patients.clear();
  db.actions.clear();
  db.cancelCalls = [];
  db.seq = 0;
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  db.patients.set("p_1", {
    id: "p_1",
    clinicId: "c1",
    fullName: "Юсупова Лола",
    phone: "+998901112233",
    lastContactedAt: new Date(NOW.getTime() - 3 * DAY),
  });
  db.appts.set("ap_1", {
    id: "ap_1",
    clinicId: "c1",
    date: APPT_AT,
    status: "BOOKED",
    priceFinal: 20_000_000,
    patientId: "p_1",
    confirmedAt: null,
    cancelReason: null,
  });
  seedRiskRow();
});

afterEach(() => {
  vi.useRealTimers();
});

const callbackTasks = () =>
  [...db.actions.values()].filter((r) => r.type === "PATIENT_CALLBACK");

// ── AC-09 ────────────────────────────────────────────────────────────────────

describe("«Хочет прийти позже» on 10.10 (AC-09 acceptance)", () => {
  // What the date input sends: `new Date("2026-10-10").toISOString()`.
  const PICKED = "2026-10-10T00:00:00.000Z";
  const RETURN_MORNING = new Date("2026-10-10T04:00:00.000Z"); // 09:00 Tashkent

  it("frees today's slot and puts a call with the note in the Action Center on 10.10", async () => {
    const { post, riskToday, list, sweep } = await routes();
    const res = await post(
      postOutcome({ outcome: "RETURN_LATER", callbackAt: PICKED, note: "после командировки" }),
    );
    expect(res.status).toBe(200);

    // Today's visit is cancelled with the patient's words: the 15:00 slot is
    // free and the patient will not be marked a no-show.
    expect(db.cancelCalls).toEqual([
      expect.objectContaining({ appointmentId: "ap_1", reason: "после командировки" }),
    ]);
    expect(db.appts.get("ap_1")!.status).toBe("CANCELLED");

    // The risk row is handled, and the trail says what was agreed.
    expect(db.actions.get("risk_1")).toMatchObject({
      status: "DONE",
      outcome: "RETURN_LATER",
      callbackAt: RETURN_MORNING,
    });
    const trail = (await (await riskToday(new Request("https://x/r"))).json()) as {
      handled: Array<{ outcome: string; callbackAt: string }>;
    };
    expect(trail.handled).toEqual([
      expect.objectContaining({ outcome: "RETURN_LATER", callbackAt: RETURN_MORNING.toISOString() }),
    ]);

    // The call lives in its own task, hidden until the return day.
    const [task] = callbackTasks();
    expect(task).toMatchObject({
      status: "SNOOZED",
      snoozeUntil: RETURN_MORNING,
      expiresAt: null,
      deeplinkPath: "/crm/patients/p_1",
      payload: expect.objectContaining({
        reason: "RETURN_LATER",
        note: "после командировки",
        callbackAt: RETURN_MORNING.toISOString(),
      }),
    });
    expect((await listPage(list)).rows.map((r) => r.id)).not.toContain(task!.id);

    // Two weeks of engine sweeps do not expire it.
    for (let t = NOW.getTime(); t < RETURN_MORNING.getTime(); t += 6 * HOUR) {
      vi.setSystemTime(t);
      await sweep();
    }
    expect(db.actions.get(task!.id)!.status).toBe("SNOOZED");

    // 10.10, 09:01: the task is in the list, note attached.
    vi.setSystemTime(RETURN_MORNING.getTime() + 60_000);
    await sweep();
    const shown = (await listPage(list)).rows.find((r) => r.id === task!.id);
    expect(shown?.payload).toMatchObject({ note: "после командировки" });

    // And it does not silently lapse if nobody gets to it that day.
    for (let t = RETURN_MORNING.getTime(); t < RETURN_MORNING.getTime() + 5 * DAY; t += 6 * HOUR) {
      vi.setSystemTime(t);
      await sweep();
    }
    expect((await listPage(list)).rows.map((r) => r.id)).toContain(task!.id);
  });

  it("refuses a return day that is not after the visit, writing nothing", async () => {
    const { post } = await routes();
    const res = await post(
      postOutcome({ outcome: "RETURN_LATER", callbackAt: "2026-09-25T00:00:00.000Z" }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("return_day_not_later");
    expect(db.cancelCalls).toHaveLength(0);
    expect(db.appts.get("ap_1")!.status).toBe("BOOKED");
    expect(db.actions.get("risk_1")!.status).toBe("OPEN");
    expect(callbackTasks()).toHaveLength(0);
  });
});

describe("«Перезвонить» tomorrow 11:00 for today's visit (AC-09 acceptance)", () => {
  const TOMORROW_11 = new Date("2026-09-26T06:00:00.000Z");

  it("is in the list tomorrow at 11:00, not before, and the visit is left alone", async () => {
    const { post, list, sweep } = await routes();
    const res = await post(
      postOutcome({ outcome: "CALLBACK", callbackAt: TOMORROW_11.toISOString(), note: "за рулём" }),
    );
    expect(res.status).toBe(200);
    expect(db.cancelCalls).toHaveLength(0);
    expect(db.appts.get("ap_1")!.status).toBe("BOOKED");
    expect(db.actions.get("risk_1")).toMatchObject({ status: "DONE", outcome: "CALLBACK" });

    const [task] = callbackTasks();
    expect(task).toMatchObject({ status: "SNOOZED", snoozeUntil: TOMORROW_11 });

    // Past the 15:00 visit the risk row would have expired; the task does not.
    for (let t = NOW.getTime(); t < TOMORROW_11.getTime(); t += HOUR) {
      vi.setSystemTime(t);
      await sweep();
    }
    vi.setSystemTime(TOMORROW_11.getTime() - 60_000);
    expect((await listPage(list)).rows.map((r) => r.id)).not.toContain(task!.id);

    vi.setSystemTime(TOMORROW_11.getTime());
    const rows = (await listPage(list)).rows;
    expect(rows.map((r) => r.id)).toContain(task!.id);
    expect(rows.find((r) => r.id === task!.id)!.payload).toMatchObject({
      reason: "CALLBACK",
      note: "за рулём",
    });
  });

  it("a callback before the visit still rides on the risk row, as before", async () => {
    const { post, riskToday } = await routes();
    const at = new Date(NOW.getTime() + 2 * HOUR); // 13:00, before the 15:00 visit
    await post(postOutcome({ outcome: "CALLBACK", callbackAt: at.toISOString() }));
    expect(callbackTasks()).toHaveLength(0);
    expect(db.actions.get("risk_1")).toMatchObject({ status: "SNOOZED", snoozeUntil: at });

    vi.setSystemTime(at.getTime() + 60_000);
    const data = (await (await riskToday(new Request("https://x/r"))).json()) as {
      appointments: Array<{ appointmentId: string }>;
    };
    expect(data.appointments.map((a) => a.appointmentId)).toEqual(["ap_1"]);
  });

  it("a second outcome on the same visit moves the same task", async () => {
    const { post } = await routes();
    await post(postOutcome({ outcome: "CALLBACK", callbackAt: TOMORROW_11.toISOString() }));
    // Another callback time recorded for the same visit (the per-action
    // outcome endpoint goes through the same helper): the task is re-timed,
    // not duplicated.
    const later = new Date(TOMORROW_11.getTime() + DAY);
    const { scheduleCallbackTask } = await import("@/server/actions/outcome");
    const { prisma } = await import("@/lib/prisma");
    await scheduleCallbackTask(prisma as never, {
      clinicId: "c1",
      appointment: {
        id: "ap_1",
        date: APPT_AT,
        patientId: "p_1",
        patientName: "Юсупова Лола",
        doctorName: "Султанов А.",
      },
      input: { outcome: "CALLBACK", note: null, callbackAt: later },
    });
    expect(callbackTasks()).toHaveLength(1);
    expect(callbackTasks()[0]).toMatchObject({ status: "SNOOZED", snoozeUntil: later });
  });
});

// ── AC-18 ────────────────────────────────────────────────────────────────────

describe("paging through every open task, KPIs over all of them (AC-18 acceptance)", () => {
  const SEVERITIES: ActionSeverity[] = ["low", "medium", "high", "critical"];

  /** 200 visible tasks plus rows no list may show. Critical ones are the
   *  OLDEST, which is exactly what a createdAt-first cut used to drop. */
  function seedMany() {
    db.actions.clear();
    for (let i = 0; i < 200; i++) {
      const severity = SEVERITIES[i % 4]!;
      const age = severity === "critical" ? 10 * DAY : (200 - i) * 60_000;
      const kind = i % 5;
      const id = `bulk_${String(i).padStart(3, "0")}`;
      const payload =
        kind === 0
          ? { type: "NO_SHOW_RISK_HIGH", appointmentId: `ap_${i}`, patientId: "p", patientName: "x", risk: 0.7, appointmentAt: APPT_AT.toISOString() }
          : kind === 1
            ? { type: "EMPTY_SLOT_TOMORROW", doctorId: `d${i}`, doctorName: "x", slotStart: APPT_AT.toISOString(), slotEnd: APPT_AT.toISOString(), specialty: "x", estimatedRevenueLossUzs: 1_000_000 }
            : kind === 2
              ? { type: "UNCONFIRMED_24H", appointmentId: `ap_${i}`, patientId: "p", patientName: "x", appointmentAt: APPT_AT.toISOString(), doctorName: "x" }
              : kind === 3
                ? { type: "PAYMENT_OVERDUE", appointmentId: `ap_${i}`, patientId: "p", patientName: "x", amountUzs: 500_000, daysOverdue: 3 }
                : { type: "PATIENT_NO_CHANNEL", patientId: `p${i}`, patientName: "x", triggerKey: "t", appointmentId: null, appointmentAt: null, bucket: "2026-09-25" };
      db.actions.set(id, {
        id,
        clinicId: "c1",
        type: payload.type,
        severity,
        status: i % 7 === 0 ? "SNOOZED" : "OPEN",
        // Some come back from «Отложить»: their timer ran out an hour ago, so
        // all 200 are visible.
        snoozeUntil: i % 7 === 0 ? new Date(NOW.getTime() - HOUR) : null,
        payload,
        dedupeKey: id,
        assigneeRole: "RECEPTIONIST",
        expiresAt: null,
        createdAt: new Date(NOW.getTime() - age),
        surfacedAt: new Date(NOW.getTime() - age),
        updatedAt: new Date(NOW.getTime() - age),
      });
    }
    // Invisible: snoozed ahead, expired, closed.
    const hidden: Array<Partial<Row>> = [
      { status: "SNOOZED", snoozeUntil: new Date(NOW.getTime() + HOUR) },
      { status: "OPEN", expiresAt: new Date(NOW.getTime() - HOUR) },
      { status: "EXPIRED" },
      { status: "DONE" },
      { status: "DISMISSED" },
    ];
    hidden.forEach((over, i) => {
      const id = `hidden_${i}`;
      db.actions.set(id, {
        id,
        clinicId: "c1",
        type: "UNCONFIRMED_24H",
        severity: "critical",
        status: "OPEN",
        snoozeUntil: null,
        expiresAt: null,
        payload: { type: "UNCONFIRMED_24H", appointmentId: id },
        dedupeKey: id,
        assigneeRole: "RECEPTIONIST",
        surfacedAt: NOW,
        ...over,
      });
    });
  }

  it("the first page holds every critical task, before any high one", async () => {
    seedMany();
    const { list } = await routes();
    const { rows, nextCursor } = await listPage(list);
    expect(rows).toHaveLength(50);
    expect(nextCursor).not.toBeNull();
    expect(rows.slice(0, 50).every((r) => r.severity === "critical")).toBe(true);
    const ranks = rows.map((r) => SEVERITY_RANK[r.severity as ActionSeverity]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it("«Показать ещё» reaches every visible task exactly once, most urgent first", async () => {
    seedMany();
    const { list } = await routes();
    const seen: ListRow[] = [];
    let cursor: string | null = null;
    do {
      const page: { rows: ListRow[]; nextCursor: string | null } = await listPage(
        list,
        `status=OPEN&status=SNOOZED&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(200);
    expect(new Set(seen.map((r) => r.id)).size).toBe(200);
    expect(seen.some((r) => r.id.startsWith("hidden_"))).toBe(false);
    const ranks = seen.map((r) => SEVERITY_RANK[r.severity as ActionSeverity]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it("the KPI summary equals the aggregate over the whole table", async () => {
    seedMany();
    const { summary } = await routes();
    const res = await summary(new Request("https://x/api/crm/actions/summary"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      byType: Record<string, number>;
      bySeverity: Record<string, number>;
      freeSlotsRevenueTiins: number;
      noShowRiskSum: number;
      paymentsAmountTiins: number;
    };

    // Brute force over the store, with the list's visibility.
    const visible = [...db.actions.values()].filter(
      (r) =>
        (r.status === "OPEN" || r.status === "SNOOZED") &&
        (r.expiresAt == null || (r.expiresAt as Date) > NOW) &&
        (r.snoozeUntil == null || (r.snoozeUntil as Date) <= NOW),
    );
    expect(visible).toHaveLength(200);
    expect(body.total).toBe(200);
    const byType: Record<string, number> = {};
    for (const r of visible) byType[r.type as string] = (byType[r.type as string] ?? 0) + 1;
    expect(body.byType).toEqual(byType);
    for (const s of ACTION_SEVERITIES) {
      expect(body.bySeverity[s]).toBe(visible.filter((r) => r.severity === s).length);
    }
    expect(body.byType.UNCONFIRMED_24H).toBe(40); // not capped by any page
    expect(body.freeSlotsRevenueTiins).toBe(40 * 1_000_000);
    expect(body.paymentsAmountTiins).toBe(40 * 500_000);
    expect(body.noShowRiskSum).toBeCloseTo(40 * 0.7, 5);
  });
});

describe("the Action Center page is wired to paging and the summary", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), "src/app/[locale]/crm/action-center", rel), "utf8");

  it("offers «Показать ещё» and takes every count from the server summary", () => {
    const src = read("_components/action-center-client.tsx");
    expect(src).toMatch(/useActionsSummary\(\)/);
    expect(src).toMatch(/kpisFromSummary\(summary, avgVisitTiins\)/);
    expect(src).not.toMatch(/bucketActions\(actions/);
    expect(src).toMatch(/hasMore \?[\s\S]*?onClick=\{onLoadMore\}/);
    expect(src).toMatch(/const total = summary\?\.total \?\? actions\.length;/);
  });

  it("the paged hook follows the list cursor and drops closed rows from every loaded page", () => {
    const src = read("_hooks/use-actions.ts");
    expect(src).toMatch(/useInfiniteQuery/);
    expect(src).toMatch(/getNextPageParam: \(last\) => last\.nextCursor \?\? undefined/);
    expect(src).toMatch(/"pages" in[\s\S]*?rows: p\.rows\.filter\(\(r\) => r\.id !== id\)/);
    expect(src).toMatch(/fetch\(`\/api\/crm\/actions\/summary`/);
  });
});
