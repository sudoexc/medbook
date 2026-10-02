/**
 * Audit AC-17 — a task whose signal went away closes promptly.
 *
 * Only three detector types carried an expiry; every other row lived OPEN
 * until the 48h sweep after its detector stopped emitting it. A debt paid at
 * the till stayed «задолженность» for two days, a visit cancelled in
 * Telegram stayed «не подтверждена», a booked slot stayed «свободен завтра».
 *
 *   - `retireVanishedSignals`: the engine closes, at the end of each pass,
 *     the detector rows it did not emit;
 *   - `retireVisitRiskActions`: cancelling or completing a visit closes its
 *     risk tasks at once;
 *   - `retireSettledDebt`: a payment that settles a visit closes its debt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const published = vi.hoisted(
  () => [] as Array<{ clinicId: string; type: string; payload: unknown }>,
);
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: (clinicId: string, ev: { type: string; payload: unknown }) => {
    published.push({ clinicId, type: ev.type, payload: ev.payload });
  },
}));

import { retireVanishedSignals } from "@/server/actions/repository";
import { retireVisitRiskActions } from "@/server/actions/in-clinic";
import { retireSettledDebt } from "@/server/actions/settled-debt";

type Row = {
  id: string;
  type: string;
  severity: string;
  status: string;
  outcome: string | null;
  dedupeKey: string;
  payload: Record<string, unknown>;
  doneAt?: Date | null;
};

const store = {
  rows: new Map<string, Row>(),
  audits: [] as Array<{ action: string; entityId: string; meta: Record<string, unknown> }>,
  appointment: null as null | {
    priceFinal: number | null;
    payments: Array<{
      amount: number;
      refundedAmount: number;
      currency: string;
      fxRate: unknown;
    }>;
  },
};

function inList(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && "in" in (cond as object)) {
    return ((cond as { in: unknown[] }).in).includes(value);
  }
  return value === cond;
}

const prisma = {
  action: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      [...store.rows.values()].filter(
        (r) =>
          (where.type === undefined || inList(r.type, where.type)) &&
          (where.status === undefined || inList(r.status, where.status)) &&
          (where.dedupeKey === undefined || inList(r.dedupeKey, where.dedupeKey)),
      ),
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: { in: string[] }; status: { in: string[] } };
      data: Partial<Row>;
    }) => {
      let count = 0;
      for (const id of where.id.in) {
        const r = store.rows.get(id);
        if (r && where.status.in.includes(r.status)) {
          Object.assign(r, data);
          count += 1;
        }
      }
      return { count };
    },
  },
  appointment: {
    findUnique: async () => store.appointment,
  },
  exchangeRate: { findFirst: async () => null },
  auditLog: {
    create: async ({ data }: { data: { action: string; entityId: string; meta: Record<string, unknown> } }) => {
      store.audits.push({ action: data.action, entityId: data.entityId, meta: data.meta });
      return {};
    },
  },
} as never;

function seed(row: Partial<Row> & { id: string; type: string; dedupeKey: string }) {
  store.rows.set(row.id, {
    severity: "medium",
    status: "OPEN",
    outcome: null,
    payload: {},
    ...row,
  });
}

beforeEach(() => {
  store.rows.clear();
  store.audits = [];
  store.appointment = null;
  published.length = 0;
});

describe("retireVanishedSignals", () => {
  it("closes the rows a detector that ran did not emit, and only those", async () => {
    seed({ id: "paid", type: "PAYMENT_OVERDUE", dedupeKey: "PAYMENT_OVERDUE:appointmentId=a1" });
    seed({ id: "owed", type: "PAYMENT_OVERDUE", dedupeKey: "PAYMENT_OVERDUE:appointmentId=a2" });
    seed({
      id: "slot",
      type: "EMPTY_SLOT_TOMORROW",
      dedupeKey: "EMPTY_SLOT_TOMORROW:doctorId=d1:slotStart=x",
    });
    seed({
      id: "snoozed",
      type: "PAYMENT_OVERDUE",
      dedupeKey: "PAYMENT_OVERDUE:appointmentId=a3",
      status: "SNOOZED",
    });

    const n = await retireVanishedSignals(
      prisma,
      "c1",
      new Map([["PAYMENT_OVERDUE", new Set(["PAYMENT_OVERDUE:appointmentId=a2"])]]),
    );

    expect(n).toBe(2);
    expect(store.rows.get("paid")!.status).toBe("EXPIRED");
    // «Отложить» does not keep a debt that was paid.
    expect(store.rows.get("snoozed")!.status).toBe("EXPIRED");
    expect(store.rows.get("owed")!.status).toBe("OPEN");
    // EMPTY_SLOT_TOMORROW's detector is not in the map (it failed): untouched.
    expect(store.rows.get("slot")!.status).toBe("OPEN");
    expect(store.audits.map((a) => a.meta.reason)).toEqual(["signal_gone", "signal_gone"]);
  });

  it("keeps a promised callback, and closes a handled row as DONE with its outcome", async () => {
    seed({
      id: "promise",
      type: "UNCONFIRMED_24H",
      dedupeKey: "UNCONFIRMED_24H:appointmentId=a1",
      status: "SNOOZED",
      outcome: "CALLBACK",
    });
    seed({
      id: "noanswer",
      type: "UNCONFIRMED_24H",
      dedupeKey: "UNCONFIRMED_24H:appointmentId=a2",
      status: "SNOOZED",
      outcome: "NO_ANSWER",
    });
    const n = await retireVanishedSignals(
      prisma,
      "c1",
      new Map([["UNCONFIRMED_24H", new Set<string>()]]),
    );
    expect(n).toBe(1);
    expect(store.rows.get("promise")!.status).toBe("SNOOZED");
    expect(store.rows.get("noanswer")).toMatchObject({ status: "DONE", outcome: "NO_ANSWER" });
  });

  it("does nothing when no detector ran", async () => {
    seed({ id: "x", type: "PAYMENT_OVERDUE", dedupeKey: "PAYMENT_OVERDUE:appointmentId=a1" });
    expect(await retireVanishedSignals(prisma, "c1", new Map())).toBe(0);
    expect(store.rows.get("x")!.status).toBe("OPEN");
  });
});

describe("retireVisitRiskActions", () => {
  function seedRisk() {
    seed({
      id: "unconf",
      type: "UNCONFIRMED_24H",
      dedupeKey: "UNCONFIRMED_24H:appointmentId=ap1",
      payload: { appointmentId: "ap1" },
    });
    seed({
      id: "risk",
      type: "NO_SHOW_RISK_HIGH",
      dedupeKey: "NO_SHOW_RISK_HIGH:appointmentId=ap1",
      payload: { appointmentId: "ap1" },
    });
    seed({
      id: "promise",
      type: "NO_CONTACT_CALL",
      dedupeKey: "NO_CONTACT_CALL:appointmentId=ap1",
      status: "SNOOZED",
      outcome: "CALLBACK",
      payload: { appointmentId: "ap1" },
    });
    seed({
      id: "other",
      type: "UNCONFIRMED_24H",
      dedupeKey: "UNCONFIRMED_24H:appointmentId=ap2",
      payload: { appointmentId: "ap2" },
    });
  }

  it("a cancelled visit's risk tasks close at once; a promised call stays", async () => {
    seedRisk();
    const n = await retireVisitRiskActions(prisma, "c1", "ap1", "CANCELLED");
    expect(n).toBe(2);
    expect(store.rows.get("unconf")!.status).toBe("EXPIRED");
    expect(store.rows.get("risk")!.status).toBe("EXPIRED");
    // The patient never came: the call promised to them is still owed.
    expect(store.rows.get("promise")!.status).toBe("SNOOZED");
    expect(store.rows.get("other")!.status).toBe("OPEN");
    expect(store.audits.map((a) => a.meta.reason)).toEqual([
      "visit_cancelled",
      "visit_cancelled",
    ]);
  });

  it("announces every task it closes as action.updated, and nothing for a visit ahead (G3-11)", async () => {
    seedRisk();
    await retireVisitRiskActions(prisma, "c1", "ap1", "CANCELLED");
    expect(published).toEqual([
      {
        clinicId: "c1",
        type: "action.updated",
        payload: { id: "unconf", type: "UNCONFIRMED_24H", severity: "medium" },
      },
      {
        clinicId: "c1",
        type: "action.updated",
        payload: { id: "risk", type: "NO_SHOW_RISK_HIGH", severity: "medium" },
      },
    ]);
    published.length = 0;
    await retireVisitRiskActions(prisma, "c1", "ap1", "CONFIRMED");
    expect(published).toEqual([]);
  });

  it("a completed visit closes every pre-arrival task", async () => {
    seedRisk();
    const n = await retireVisitRiskActions(prisma, "c1", "ap1", "COMPLETED");
    expect(n).toBe(3);
    expect(store.rows.get("promise")).toMatchObject({ status: "DONE", outcome: "CALLBACK" });
  });

  it("a visit still ahead keeps its tasks", async () => {
    seedRisk();
    expect(await retireVisitRiskActions(prisma, "c1", "ap1", "CONFIRMED")).toBe(0);
    expect(store.rows.get("unconf")!.status).toBe("OPEN");
  });

  it("never throws: the visit change is already committed", async () => {
    await expect(
      retireVisitRiskActions({} as never, "c1", "ap1", "CANCELLED"),
    ).resolves.toBe(0);
  });
});

describe("retireSettledDebt", () => {
  function seedDebt() {
    seed({
      id: "debt",
      type: "PAYMENT_OVERDUE",
      dedupeKey: "PAYMENT_OVERDUE:appointmentId=ap1",
      severity: "high",
    });
  }

  it("closes the debt once the visit is fully paid", async () => {
    seedDebt();
    store.appointment = {
      priceFinal: 300_000_00,
      payments: [
        { amount: 300_000_00, refundedAmount: 0, currency: "UZS", fxRate: null },
      ],
    };
    expect(await retireSettledDebt(prisma, "c1", "ap1")).toBe(1);
    expect(store.rows.get("debt")!.status).toBe("EXPIRED");
    expect(store.audits[0]?.meta.reason).toBe("debt_paid");
  });

  it("a part payment leaves it open", async () => {
    seedDebt();
    store.appointment = {
      priceFinal: 300_000_00,
      payments: [
        { amount: 100_000_00, refundedAmount: 0, currency: "UZS", fxRate: null },
      ],
    };
    expect(await retireSettledDebt(prisma, "c1", "ap1")).toBe(0);
    expect(store.rows.get("debt")!.status).toBe("OPEN");
  });

  it("does nothing without an open debt task", async () => {
    store.appointment = { priceFinal: 1, payments: [] };
    expect(await retireSettledDebt(prisma, "c1", "ap1")).toBe(0);
  });
});
