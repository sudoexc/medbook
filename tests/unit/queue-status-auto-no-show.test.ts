/**
 * Pre-deploy review: a late patient after the sweep's automatic no-show.
 *
 * Reception books a CONFIRMED phone slot at 10:00 and the patient walks in
 * at 11:45. Around 11:40 the lifecycle sweep writes NO_SHOW to both status
 * columns (Q-14). Before the fix the doctors panel had no «Пришёл» on the
 * row, the drawer chain offered nothing and PATCH queue-status WAITING
 * answered `invalid_transition` («Ошибка изменения статуса»): the desk had
 * to register a second walk-in visit and the patient's history kept a false
 * no-show next to it.
 *
 * Acceptance: on the visit's own clinic day «Пришёл» checks the sweep's
 * no-show in (ticket allocated, both columns WAITING, audit says so), and
 * the panel offers it on exactly those rows; a no-show a person marked, one
 * the row has already left, or one from another day stays final and the
 * desk is told to use the live queue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type AuditRow = {
  entityId: string;
  action: string;
  createdAt: Date;
};

const h = vi.hoisted(() => ({
  aggregate: vi.fn(async () => ({ _max: { queueOrder: 4, ticketSeq: 4 } })),
  audit: vi.fn(async (_req: unknown, _input: unknown) => undefined),
  recompute: vi.fn(async () => undefined),
  auditFindMany: vi.fn(),
  updates: [] as Array<{ id: string; data: Row }>,
}));

const state = {
  appts: new Map<string, Row>(),
  auditRows: [] as AuditRow[],
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function appt(id: string, over: Row = {}): Row {
  const start = new Date();
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    doctorId: "doc_1",
    cabinetId: null,
    channel: "PHONE",
    status: "NO_SHOW",
    queueStatus: "NO_SHOW",
    date: start,
    endDate: new Date(start.getTime() + 30 * MIN),
    time: null,
    durationMin: 30,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    queueOrder: null,
    ticketSeq: null,
    queuedAt: null,
    medicalCaseId: null,
    ...over,
  };
}

/** The audit row the sweep writes when it flips `id` to NO_SHOW. */
function sweptAt(id: string, at: Date): AuditRow {
  return { entityId: id, action: "appointment.auto-no-show", createdAt: at };
}

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "u_recept",
      role: "RECEPTIONIST",
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
    userId: "u_recept",
    role: "RECEPTIONIST",
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/telegram/call-notice", () => ({
  sendCallNotice: vi.fn(async () => true),
}));
vi.mock("@/server/visit-notes/unsigned-draft", () => ({
  findUnsignedDraft: vi.fn(async () => null),
}));
vi.mock("@/server/appointments/completion-effects", () => ({
  runCompletionEffects: vi.fn(async () => undefined),
}));
vi.mock("@/server/pricing/recompute-appointment-price", () => ({
  recomputeAppointmentPrice: vi.fn(async () => null),
  recomputeCaseAppointments: h.recompute,
}));
vi.mock("@/server/appointments/book", () => ({ bookAppointment: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const appointment = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = state.appts.get(where.id);
      return row ? { ...row } : null;
    }),
    // The list GET: every row, in insertion order (paging is not under test).
    findMany: vi.fn(async () => [...state.appts.values()].map((r) => ({ ...r }))),
    count: vi.fn(async () => state.appts.size),
    groupBy: vi.fn(async () => []),
    aggregate: h.aggregate,
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      h.updates.push({ id: where.id, data });
      const next = { ...state.appts.get(where.id), ...data };
      state.appts.set(where.id, next);
      return {
        ...next,
        patient: { fullName: "Каримова Дилноза", telegramId: null, preferredLang: "RU" },
        doctor: { nameRu: "Султанов А.", ticketPrefix: "A", cabinet: { number: "5" } },
        clinic: { id: "c1", slug: "neurofax", tgBotToken: null, tgBotUsername: null },
      };
    }),
  };
  h.auditFindMany.mockImplementation(
    async ({
      where,
    }: {
      where: { entityId: { in: string[] }; action: { in: string[] } };
    }) =>
      state.auditRows.filter(
        (r) =>
          where.entityId.in.includes(r.entityId) &&
          where.action.in.includes(r.action),
      ),
  );
  const prisma = {
    appointment,
    auditLog: {
      create: vi.fn(async () => ({ id: "al" })),
      findMany: h.auditFindMany,
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  };
  return { prisma };
});

import { autoNoShowStands } from "@/server/appointments/auto-no-show";
import { canArriveAfterAutoNoShow } from "@/lib/appointment-transitions";
import { getQuickActions } from "@/lib/appointments/lifecycle";
import { PATCH } from "@/app/api/crm/appointments/[id]/queue-status/route";
import { GET } from "@/app/api/crm/appointments/route";

async function queueStatus(id: string, target: string): Promise<Response> {
  return PATCH(
    new Request(`https://x/api/crm/appointments/${id}/queue-status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queueStatus: target }),
    }),
  );
}

beforeEach(() => {
  h.aggregate.mockClear();
  h.audit.mockClear();
  h.recompute.mockClear();
  h.auditFindMany.mockClear();
  h.updates = [];
  state.appts = new Map();
  state.auditRows = [];
});

describe("autoNoShowStands: is the current NO_SHOW still the sweep's?", () => {
  const t = (min: number) => new Date(Date.UTC(2026, 8, 26, 6, min));

  it("the sweep's flip with nothing after it stands", () => {
    expect(
      autoNoShowStands([
        { action: "appointment.queue-status", createdAt: t(0) },
        { action: "appointment.auto-no-show", createdAt: t(40) },
      ]),
    ).toBe(true);
  });

  it("left through «Пришёл» (queue-status) after the flip: a later NO_SHOW is a person's", () => {
    expect(
      autoNoShowStands([
        { action: "appointment.auto-no-show", createdAt: t(40) },
        { action: "appointment.queue-status", createdAt: t(45) },
      ]),
    ).toBe(false);
  });

  it("left through the doctor's revert after the flip: same", () => {
    expect(
      autoNoShowStands([
        { action: "appointment.auto-no-show", createdAt: t(40) },
        { action: "APPOINTMENT_STATUS_REVERTED", createdAt: t(50) },
      ]),
    ).toBe(false);
  });

  it("a fresh sweep flip after an earlier revert stands again", () => {
    expect(
      autoNoShowStands([
        { action: "appointment.auto-no-show", createdAt: t(10) },
        { action: "APPOINTMENT_STATUS_REVERTED", createdAt: t(20) },
        { action: "appointment.auto-no-show", createdAt: t(50) },
      ]),
    ).toBe(true);
  });

  it("no sweep row at all, or a tie with an exit, does not stand", () => {
    expect(autoNoShowStands([])).toBe(false);
    expect(
      autoNoShowStands([{ action: "appointment.update", createdAt: t(1) }]),
    ).toBe(false);
    expect(
      autoNoShowStands([
        { action: "appointment.auto-no-show", createdAt: t(40) },
        { action: "appointment.queue-status", createdAt: t(40) },
      ]),
    ).toBe(false);
  });
});

describe("canArriveAfterAutoNoShow and the doctors panel's quick actions", () => {
  // 12:00 in Tashkent; the slot was 10:00 the same clinic day.
  const now = new Date("2026-09-26T07:00:00Z");
  const slot = new Date("2026-09-26T05:00:00Z");
  const yesterday = new Date("2026-09-25T05:00:00Z");

  it("only the sweep's no-show, only on its own clinic day", () => {
    expect(canArriveAfterAutoNoShow("NO_SHOW", slot, true, now)).toBe(true);
    expect(canArriveAfterAutoNoShow("NO_SHOW", slot, false, now)).toBe(false);
    expect(canArriveAfterAutoNoShow("NO_SHOW", yesterday, true, now)).toBe(false);
    expect(canArriveAfterAutoNoShow("CANCELLED", slot, true, now)).toBe(false);
  });

  it("reception gets «Пришёл» on today's auto no-show", () => {
    expect(
      getQuickActions("NO_SHOW", "RECEPTIONIST", slot, now, { autoNoShow: true }),
    ).toEqual([{ kind: "ARRIVED", to: "WAITING", confirm: false }]);
    expect(
      getQuickActions("NO_SHOW", "ADMIN", slot, now, { autoNoShow: true }),
    ).toEqual([{ kind: "ARRIVED", to: "WAITING", confirm: false }]);
  });

  it("nothing on a person's no-show, yesterday's, or for the doctor", () => {
    expect(getQuickActions("NO_SHOW", "RECEPTIONIST", slot, now)).toEqual([]);
    expect(
      getQuickActions("NO_SHOW", "RECEPTIONIST", yesterday, now, {
        autoNoShow: true,
      }),
    ).toEqual([]);
    expect(
      getQuickActions("NO_SHOW", "DOCTOR", slot, now, { autoNoShow: true }),
    ).toEqual([]);
    expect(
      getQuickActions("NO_SHOW", "NURSE", slot, now, { autoNoShow: true }),
    ).toEqual([]);
  });
});

describe("PATCH queue-status WAITING on a no-show", () => {
  it("today's auto no-show is checked in: ticket, both columns, audit", async () => {
    state.appts.set("ns", appt("ns"));
    state.auditRows = [sweptAt("ns", new Date(Date.now() - 5 * MIN))];

    const res = await queueStatus("ns", "WAITING");

    expect(res.status).toBe(200);
    expect(h.aggregate).toHaveBeenCalled();
    expect(state.appts.get("ns")).toMatchObject({
      status: "WAITING",
      queueStatus: "WAITING",
      queueOrder: 5,
      ticketSeq: 5,
    });
    expect((state.appts.get("ns")!.queuedAt as Date) instanceof Date).toBe(true);
    const auditInput = h.audit.mock.calls
      .map((c) => c[1] as { action: string; meta: Row })
      .find((a) => a.action === "appointment.queue-status");
    expect(auditInput?.meta).toMatchObject({
      before: "NO_SHOW",
      after: "WAITING",
      afterAutoNoShow: true,
    });
    // Not in a case: no repricing.
    expect(h.recompute).not.toHaveBeenCalled();
  });

  it("a visit in a case is repriced with it counted again", async () => {
    state.appts.set("ns", appt("ns", { medicalCaseId: "case_1" }));
    state.auditRows = [sweptAt("ns", new Date(Date.now() - 5 * MIN))];

    const res = await queueStatus("ns", "WAITING");

    expect(res.status).toBe(200);
    expect(h.recompute).toHaveBeenCalledWith(expect.anything(), "case_1");
  });

  it("a no-show a person marked stays final: 409 no_show_final, nothing written", async () => {
    state.appts.set("ns", appt("ns"));

    const res = await queueStatus("ns", "WAITING");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("no_show_final");
    expect(h.updates).toEqual([]);
    expect(h.aggregate).not.toHaveBeenCalled();
  });

  it("an auto no-show already left once (then marked by hand) stays final", async () => {
    state.appts.set("ns", appt("ns"));
    state.auditRows = [
      sweptAt("ns", new Date(Date.now() - 60 * MIN)),
      {
        entityId: "ns",
        action: "appointment.queue-status",
        createdAt: new Date(Date.now() - 30 * MIN),
      },
    ];

    const res = await queueStatus("ns", "WAITING");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("no_show_final");
    expect(h.updates).toEqual([]);
  });

  it("yesterday's auto no-show cannot arrive today", async () => {
    const start = new Date(Date.now() - DAY);
    state.appts.set(
      "ns",
      appt("ns", { date: start, endDate: new Date(start.getTime() + 30 * MIN) }),
    );
    state.auditRows = [sweptAt("ns", new Date(start.getTime() + 100 * MIN))];

    const res = await queueStatus("ns", "WAITING");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("no_show_final");
    expect(h.updates).toEqual([]);
  });

  it("only arrival reopens it: straight to IN_PROGRESS is still refused", async () => {
    state.appts.set("ns", appt("ns"));
    state.auditRows = [sweptAt("ns", new Date(Date.now() - 5 * MIN))];

    const res = await queueStatus("ns", "IN_PROGRESS");

    expect(res.status).toBe(409);
    expect(((await res.json()) as Row).reason).toBe("invalid_transition");
    expect(h.updates).toEqual([]);
  });
});

describe("GET /api/crm/appointments flags today's auto no-shows", () => {
  it("autoNoShow only on today's standing sweep no-show, lookup limited to today's NO_SHOW rows", async () => {
    const start = new Date(Date.now() - DAY);
    state.appts.set("auto", appt("auto"));
    state.appts.set("staff", appt("staff"));
    state.appts.set(
      "old",
      appt("old", { date: start, endDate: new Date(start.getTime() + 30 * MIN) }),
    );
    state.appts.set(
      "live",
      appt("live", { status: "CONFIRMED", queueStatus: "CONFIRMED" }),
    );
    state.auditRows = [
      sweptAt("auto", new Date(Date.now() - 5 * MIN)),
      sweptAt("old", new Date(start.getTime() + 100 * MIN)),
    ];

    const res = await GET(new Request("https://x/api/crm/appointments?limit=50"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<Row> };
    const flag = Object.fromEntries(body.rows.map((r) => [r.id, r.autoNoShow]));
    expect(flag).toEqual({
      auto: true,
      staff: undefined,
      old: undefined,
      live: undefined,
    });
    expect(h.auditFindMany).toHaveBeenCalledTimes(1);
    const where = (h.auditFindMany.mock.calls[0]![0] as {
      where: { entityId: { in: string[] } };
    }).where;
    expect(where.entityId.in.sort()).toEqual(["auto", "staff"]);
  });

  it("no NO_SHOW rows today: no audit lookup at all", async () => {
    state.appts.set(
      "live",
      appt("live", { status: "CONFIRMED", queueStatus: "CONFIRMED" }),
    );

    const res = await GET(new Request("https://x/api/crm/appointments?limit=50"));

    expect(res.status).toBe(200);
    expect(h.auditFindMany).not.toHaveBeenCalled();
  });
});
