/**
 * Unit tests for the Phase 8a conversion-funnel pure aggregators.
 *
 * Each computeXxx function is fully pure (no Prisma, no clocks) — we feed
 * fixture rows directly and assert numerator/denominator math + sparkline
 * shape. The Prisma layer is the API route's responsibility and is covered
 * by e2e.
 */
import { describe, it, expect } from "vitest";

import {
  computeAverageWaitTime,
  computeCallFunnel,
  computeNoShowRanks,
  computeTgFunnel,
} from "@/server/analytics/funnels";

const FROM = new Date(2026, 3, 1); // Apr 1 2026 local 00:00
const TO = new Date(2026, 3, 8); // Apr 8 2026 local 00:00 (exclusive — 7-day window)

const day = (d: number, h = 10) => new Date(2026, 3, d, h, 0, 0, 0);

describe("computeTgFunnel", () => {
  it("counts conversion only when patient booked within ≤7 days after first IN", () => {
    const r = computeTgFunnel({
      window: { from: FROM, to: TO },
      conversations: [
        { id: "c1", patientId: "p1", firstInboundAt: day(1) },
        { id: "c2", patientId: "p2", firstInboundAt: day(2) },
        { id: "c3", patientId: null, firstInboundAt: day(3) }, // bot-only
      ],
      appointments: [
        // p1 books 3 days later → counts.
        { patientId: "p1", createdAt: day(4), status: "BOOKED" },
        // p2's only appt is older than the IN message → doesn't count.
        { patientId: "p2", createdAt: day(1, 8), status: "BOOKED" },
        // Late-but-cancelled booking — excluded by status.
        { patientId: "p2", createdAt: day(3), status: "CANCELLED" },
      ],
    });

    expect(r.total).toBe(3);
    expect(r.converted).toBe(1);
    expect(r.rate).toBeCloseTo(1 / 3, 6);
  });

  it("emits one daily point per day in the window", () => {
    const r = computeTgFunnel({
      window: { from: FROM, to: TO },
      conversations: [
        { id: "c1", patientId: "p1", firstInboundAt: day(1) },
        { id: "c2", patientId: "p1", firstInboundAt: day(1, 14) }, // same day
      ],
      appointments: [
        { patientId: "p1", createdAt: day(2), status: "COMPLETED" },
      ],
    });

    expect(r.daily.length).toBe(7); // Apr 1..7 inclusive
    const apr1 = r.daily.find((d) => d.date === "2026-04-01");
    expect(apr1?.total).toBe(2);
    expect(apr1?.converted).toBe(2);
    const apr3 = r.daily.find((d) => d.date === "2026-04-03");
    expect(apr3?.total).toBe(0);
    expect(apr3?.rate).toBe(0); // guard against /0
  });

  it("ignores conversations whose first IN is outside the window", () => {
    const r = computeTgFunnel({
      window: { from: FROM, to: TO },
      conversations: [
        { id: "c1", patientId: "p1", firstInboundAt: new Date(2026, 2, 25) }, // before
        { id: "c2", patientId: "p2", firstInboundAt: new Date(2026, 3, 10) }, // after
      ],
      appointments: [],
    });
    expect(r.total).toBe(0);
    expect(r.rate).toBe(0);
  });

  it("respects custom windowDays cutoff", () => {
    const r = computeTgFunnel({
      window: { from: FROM, to: TO },
      conversations: [{ id: "c1", patientId: "p1", firstInboundAt: day(1) }],
      appointments: [
        { patientId: "p1", createdAt: day(7), status: "BOOKED" }, // +6 days
      ],
      windowDays: 3,
    });
    expect(r.converted).toBe(0); // 6 days > 3-day cutoff
  });
});

describe("computeCallFunnel", () => {
  it("denominator excludes incomplete calls (MISSED / 0 duration)", () => {
    const r = computeCallFunnel({
      window: { from: FROM, to: TO },
      calls: [
        { id: "k1", patientId: "p1", createdAt: day(1), completed: true },
        { id: "k2", patientId: "p2", createdAt: day(2), completed: false },
        { id: "k3", patientId: "p3", createdAt: day(3), completed: true },
      ],
      appointments: [
        { patientId: "p1", createdAt: day(2), status: "BOOKED" },
        // p3 booked 8 days later — outside the 7-day window
        { patientId: "p3", createdAt: day(11), status: "BOOKED" },
      ],
    });

    expect(r.total).toBe(2); // k2 dropped
    expect(r.converted).toBe(1);
  });

  it("anonymous calls (no patientId) count toward total but never convert", () => {
    const r = computeCallFunnel({
      window: { from: FROM, to: TO },
      calls: [
        { id: "k1", patientId: null, createdAt: day(1), completed: true },
      ],
      appointments: [
        // Even an existing appt can't match — no patientId on the call.
        { patientId: "p1", createdAt: day(2), status: "BOOKED" },
      ],
    });
    expect(r.total).toBe(1);
    expect(r.converted).toBe(0);
  });
});

describe("computeNoShowRanks", () => {
  it("ranks doctors by no-show rate desc, ties broken by total desc", () => {
    const r = computeNoShowRanks({
      appointments: [
        // doc A: 2 no-show, 2 completed → 50% (4 total)
        { doctorId: "A", serviceId: "s1", status: "NO_SHOW" },
        { doctorId: "A", serviceId: "s1", status: "NO_SHOW" },
        { doctorId: "A", serviceId: "s1", status: "COMPLETED" },
        { doctorId: "A", serviceId: "s1", status: "COMPLETED" },
        // doc B: 1 no-show, 1 completed → 50% (2 total) — ties A but smaller
        { doctorId: "B", serviceId: "s2", status: "NO_SHOW" },
        { doctorId: "B", serviceId: "s2", status: "COMPLETED" },
        // doc C: 1 no-show, 9 completed → 10%
        { doctorId: "C", serviceId: "s2", status: "NO_SHOW" },
        ...Array.from({ length: 9 }, () => ({
          doctorId: "C",
          serviceId: "s2",
          status: "COMPLETED" as const,
        })),
        // BOOKED rows must be ignored (only COMPLETED + NO_SHOW count).
        { doctorId: "A", serviceId: "s1", status: "BOOKED" },
        { doctorId: "C", serviceId: "s2", status: "CANCELLED" },
      ],
    });

    expect(r.byDoctor.map((x) => x.id)).toEqual(["A", "B", "C"]);
    expect(r.byDoctor[0]).toMatchObject({
      id: "A",
      noShow: 2,
      completed: 2,
      total: 4,
    });
    expect(r.byDoctor[0]?.rate).toBeCloseTo(0.5, 6);

    // By service: s1 = 2/4 = 50%, s2 = 2/12 = ~16.67%.
    expect(r.byService.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(r.byService[1]?.rate).toBeCloseTo(2 / 12, 6);
  });

  it("returns empty arrays when no qualifying rows", () => {
    const r = computeNoShowRanks({
      appointments: [
        { doctorId: "A", serviceId: "s1", status: "BOOKED" },
        { doctorId: "B", serviceId: null, status: "CANCELLED" },
      ],
    });
    expect(r.byDoctor).toEqual([]);
    expect(r.byService).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const appts = Array.from({ length: 15 }, (_, i) => ({
      doctorId: `D${i}`,
      serviceId: null,
      status: "NO_SHOW" as const,
    }));
    const r = computeNoShowRanks({ appointments: appts, limit: 5 });
    expect(r.byDoctor.length).toBe(5);
  });
});

describe("computeAverageWaitTime", () => {
  it("averages startedAt − calledAt per doctor and sorts desc", () => {
    const ref = new Date(2026, 3, 5, 10, 0, 0);
    const sec = (n: number) => new Date(ref.getTime() + n * 1000);

    const r = computeAverageWaitTime({
      appointments: [
        // doc A: 60s and 120s waits → avg 90s
        { doctorId: "A", calledAt: ref, startedAt: sec(60) },
        { doctorId: "A", calledAt: ref, startedAt: sec(120) },
        // doc B: 30s wait → avg 30s
        { doctorId: "B", calledAt: ref, startedAt: sec(30) },
        // Skipped: missing timestamp
        { doctorId: "C", calledAt: null, startedAt: sec(10) },
        { doctorId: "C", calledAt: ref, startedAt: null },
        // Skipped: negative delta (clock skew / data corruption)
        { doctorId: "D", calledAt: sec(60), startedAt: ref },
      ],
    });

    expect(r.length).toBe(2);
    expect(r[0]).toMatchObject({ doctorId: "A", avgWaitSec: 90, samples: 2 });
    expect(r[1]).toMatchObject({ doctorId: "B", avgWaitSec: 30, samples: 1 });
  });

  it("returns empty array when no usable pairs", () => {
    const r = computeAverageWaitTime({
      appointments: [
        { doctorId: "A", calledAt: null, startedAt: null },
      ],
    });
    expect(r).toEqual([]);
  });
});
