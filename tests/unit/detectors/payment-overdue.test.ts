/**
 * Tests for the PAYMENT_OVERDUE detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - completed appt with unpaid balance → one payload
 *   - completed appt fully paid → suppressed
 *   - severity scales by daysOverdue (medium / high / critical)
 *   - dedupe — repeated runs yield identical payloads
 */
import { describe, it, expect } from "vitest";

import {
  detectPaymentOverdue,
  severityForPaymentOverdue,
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
  payments: Array<{ amount: number; status: string }>;
};

function makePrisma(rows: Appt[]) {
  return {
    appointment: { findMany: async () => rows },
  } as never;
}

const now = new Date("2026-05-06T08:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

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
});
