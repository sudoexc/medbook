/**
 * Tests for the PAYMENT_OVERDUE detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - completed appt with unpaid balance → one payload
 *   - completed appt fully paid → suppressed
 *   - severity scales by daysOverdue (medium / high / critical)
 *   - dedupe — repeated runs yield identical payloads
 *   - nothing while the clinic records no payments, and only visits since it
 *     does, inside the window (audit AC-06)
 *   - refunds and USD payments count the way the patient balance counts them
 */
import { describe, it, expect } from "vitest";

import {
  detectPaymentOverdue,
  severityForPaymentOverdue,
  visitDebtTiins,
} from "@/server/actions/detectors/payment-overdue";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Appt = {
  id: string;
  patientId: string;
  date: Date;
  completedAt: Date | null;
  priceFinal: number | null;
  patient: { fullName: string };
  payments: Array<{
    amount: number;
    status: string;
    refundedAmount?: number;
    currency?: string;
    fxRate?: unknown;
  }>;
};

const now = new Date("2026-05-06T08:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

/** The appointment query of the last `makePrisma` client, if it ran. */
let apptQuery: { where?: Record<string, unknown> } | null = null;

/**
 * `trackedSince` is `Clinic.paymentsTrackedSince`; the default turned it on
 * long ago, so the old cases below read as before. The mock returns every
 * row whatever the where (it is asserted separately), with PAID rows only,
 * as the detector's nested `where` asks, and UZS unless a row says so.
 */
function makePrisma(
  rows: Appt[],
  trackedSince: Date | null = new Date(now.getTime() - 400 * dayMs),
  latestRate: unknown = null,
) {
  apptQuery = null;
  return {
    clinic: {
      findUnique: async () => ({ paymentsTrackedSince: trackedSince }),
    },
    exchangeRate: {
      findFirst: async () => (latestRate == null ? null : { rateUsd: latestRate }),
    },
    appointment: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        apptQuery = args;
        return rows.map((r) => ({
          ...r,
          payments: r.payments
            .filter((p) => p.status === "PAID")
            .map((p) => ({
              amount: p.amount,
              refundedAmount: p.refundedAmount ?? 0,
              currency: p.currency ?? "UZS",
              fxRate: p.fxRate ?? null,
            })),
        }));
      },
    },
  } as never;
}

function unpaid(overrides: Partial<Appt> = {}): Appt {
  const completedAt = new Date(now.getTime() - 5 * dayMs);
  return {
    id: "a1",
    patientId: "p1",
    date: completedAt,
    completedAt,
    priceFinal: 500_000_00,
    patient: { fullName: "Иван" },
    payments: [],
    ...overrides,
  };
}

describe("detectPaymentOverdue", () => {
  it("returns [] when no completed unpaid appts", async () => {
    const out = await detectPaymentOverdue(
      makePrisma([]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("returns [] when appt is fully paid", async () => {
    const completedAt = new Date(now.getTime() - 10 * dayMs);
    const out = await detectPaymentOverdue(
      makePrisma([
        {
          id: "a1",
          patientId: "p1",
          date: completedAt,
          completedAt,
          priceFinal: 500_000_00,
          patient: { fullName: "Иван" },
          payments: [{ amount: 500_000_00, status: "PAID" }],
        },
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload with correct outstanding amount", async () => {
    const completedAt = new Date(now.getTime() - 5 * dayMs);
    const out = await detectPaymentOverdue(
      makePrisma([
        {
          id: "a1",
          patientId: "p1",
          date: completedAt,
          completedAt,
          priceFinal: 500_000_00,
          patient: { fullName: "Иван" },
          payments: [{ amount: 200_000_00, status: "PAID" }],
        },
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("PAYMENT_OVERDUE");
    expect(out[0]?.amountUzs).toBe(300_000_00);
    expect(out[0]?.daysOverdue).toBe(5);
    expect(out[0]?.patientName).toBe("Иван");
  });

  it("severity scales with daysOverdue", () => {
    const make = (daysOverdue: number) => ({
      type: "PAYMENT_OVERDUE" as const,
      appointmentId: "a1",
      patientId: "p1",
      patientName: "x",
      amountUzs: 100_000_00,
      daysOverdue,
    });
    expect(severityForPaymentOverdue(make(2))).toBe("medium");
    expect(severityForPaymentOverdue(make(10))).toBe("high");
    expect(severityForPaymentOverdue(make(45))).toBe("critical");
  });

  it("dedupe — repeated runs yield identical payloads", async () => {
    const completedAt = new Date(now.getTime() - 5 * dayMs);
    const rows: Appt[] = [
      {
        id: "a1",
        patientId: "p1",
        date: completedAt,
        completedAt,
        priceFinal: 500_000_00,
        patient: { fullName: "Иван" },
        payments: [{ amount: 200_000_00, status: "PAID" }],
      },
    ];
    const a = await detectPaymentOverdue(makePrisma(rows), "c1", now, DEFAULT_CONFIG);
    const b = await detectPaymentOverdue(makePrisma(rows), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });
  // Audit AC-06: this clinic takes money at the till and records nothing.
  it("emits nothing while the clinic does not record payments", async () => {
    const out = await detectPaymentOverdue(
      makePrisma([unpaid()], null),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
    expect(apptQuery).toBeNull();
  });

  it("reads only visits completed since tracking began, inside the window", async () => {
    const since = new Date(now.getTime() - 10 * dayMs);
    await detectPaymentOverdue(makePrisma([], since), "c1", now, DEFAULT_CONFIG);
    const or = (apptQuery?.where?.OR ?? []) as Array<Record<string, unknown>>;
    const byCompletion = or[0]?.completedAt as { gte: Date; lte: Date };
    // Tracking began 10 days ago, inside the 90-day window: it bounds.
    expect(byCompletion.gte.getTime()).toBe(since.getTime());
    // A visit becomes a debt the day after, not the minute it closes.
    expect(byCompletion.lte.getTime()).toBe(
      now.getTime() - DEFAULT_CONFIG.paymentOverdueMinDays * dayMs,
    );
    expect(DEFAULT_CONFIG.paymentOverdueMinDays).toBeGreaterThanOrEqual(1);
    // A legacy row without completedAt is bounded by its slot time.
    expect((or[1]?.date as { gte: Date }).gte.getTime()).toBe(since.getTime());
  });

  it("bounds by the window when tracking began long ago", async () => {
    await detectPaymentOverdue(makePrisma([]), "c1", now, DEFAULT_CONFIG);
    const or = (apptQuery?.where?.OR ?? []) as Array<Record<string, unknown>>;
    expect((or[0]?.completedAt as { gte: Date }).gte.getTime()).toBe(
      now.getTime() - DEFAULT_CONFIG.paymentOverdueWindowDays * dayMs,
    );
  });

  it("reads nothing when tracking began after the minimum age", async () => {
    const since = new Date(now.getTime() - 60 * 60 * 1000);
    const out = await detectPaymentOverdue(
      makePrisma([unpaid()], since),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
    expect(apptQuery).toBeNull();
  });

  it("counts payments net of refunds", async () => {
    const out = await detectPaymentOverdue(
      makePrisma([
        unpaid({
          payments: [{ amount: 500_000_00, refundedAmount: 200_000_00, status: "PAID" }],
        }),
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out[0]?.amountUzs).toBe(200_000_00);
  });

  it("converts a USD payment like the patient balance does", async () => {
    // 40 USD at 12 500 сум/USD = 500 000 сум: the visit is paid.
    const paid = await detectPaymentOverdue(
      makePrisma([
        unpaid({
          payments: [{ amount: 40_00, currency: "USD", fxRate: 12500, status: "PAID" }],
        }),
      ]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(paid).toEqual([]);
    // Without its own rate the clinic's latest one is used.
    expect(
      visitDebtTiins(500_000_00, [
        { amount: 20_00, currency: "USD", fxRate: null, refundedAmount: 0 },
      ], 12500),
    ).toBe(250_000_00);
  });
});
