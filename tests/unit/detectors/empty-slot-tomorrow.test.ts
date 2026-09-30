/**
 * Tests for the EMPTY_SLOT_TOMORROW detector.
 *
 * Mocks Prisma's findMany calls and verifies:
 *   - empty input → empty array
 *   - peak-hour gap → one payload with correct slot timing
 *   - severity rule (>1M UZS = high)
 *   - dedupe — running twice yields identical payloads
 *   - time off and the schedule's validity range are honoured (audit AC-11)
 */
import { describe, it, expect } from "vitest";

import {
  detectEmptySlotTomorrow,
  severityForEmptySlot,
} from "@/server/actions/detectors/empty-slot-tomorrow";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Doctor = {
  id: string;
  nameRu: string;
  specializationRu: string;
  pricePerVisit: number | null;
  isActive: boolean;
};
type Schedule = {
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: Date | null;
  validTo?: Date | null;
};
type TimeOff = { doctorId: string; startAt: Date; endAt: Date };
type Appt = {
  doctorId: string;
  date: Date;
  endDate: Date;
  status?: string;
  completedAt?: Date | null;
  priceFinal?: number | null;
};

function makePrisma(state: {
  doctors: Doctor[];
  schedules: Schedule[];
  appts: Appt[];
  paid: Array<{ doctorId: string; priceFinal: number | null }>;
  timeOffs?: TimeOff[];
}) {
  return {
    doctor: { findMany: async () => state.doctors },
    doctorSchedule: { findMany: async () => state.schedules },
    doctorTimeOff: { findMany: async () => state.timeOffs ?? [] },
    appointment: {
      findMany: async ({ where }: { where: { status?: unknown } }) => {
        // Distinguish the two appointment.findMany call sites:
        // 1. tomorrow's bookings → `status: { notIn: ['CANCELLED'] }`
        // 2. paid history          → `status: 'COMPLETED'`
        const status = where?.status as
          | { notIn?: string[] }
          | string
          | undefined;
        if (status === "COMPLETED") return state.paid;
        return state.appts;
      },
    },
  } as never;
}

describe("detectEmptySlotTomorrow", () => {
  const now = new Date("2026-05-06T08:00:00.000Z"); // weekday=Wed -> tomorrow=Thu (4)
  const tomorrowWeekday = new Date("2026-05-07T00:00:00.000Z").getUTCDay();

  it("returns [] when no doctors active", async () => {
    const out = await detectEmptySlotTomorrow(
      makePrisma({ doctors: [], schedules: [], appts: [], paid: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload for an empty peak-hour block", async () => {
    const out = await detectEmptySlotTomorrow(
      makePrisma({
        doctors: [
          {
            id: "d1",
            nameRu: "Иванов",
            specializationRu: "Кардиолог",
            pricePerVisit: 500_000_00, // 500_000 UZS in tiins
            isActive: true,
          },
        ],
        schedules: [
          {
            doctorId: "d1",
            weekday: tomorrowWeekday,
            startTime: "10:00",
            endTime: "14:00",
          },
        ],
        appts: [], // no booked appointments
        paid: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("EMPTY_SLOT_TOMORROW");
    expect(out[0]?.doctorId).toBe("d1");
    // 4 hour empty block * 500_000 tiins per visit = 2_000_000 tiins
    expect(out[0]?.estimatedRevenueLossUzs).toBe(4 * 500_000_00);
  });

  it("severity escalates above 1M UZS (100M tiins)", () => {
    const high = severityForEmptySlot({
      type: "EMPTY_SLOT_TOMORROW",
      doctorId: "d1",
      doctorName: "x",
      slotStart: "2026-05-07T10:00:00.000Z",
      slotEnd: "2026-05-07T14:00:00.000Z",
      specialty: "x",
      estimatedRevenueLossUzs: 200_000_000,
    });
    const med = severityForEmptySlot({
      type: "EMPTY_SLOT_TOMORROW",
      doctorId: "d1",
      doctorName: "x",
      slotStart: "2026-05-07T10:00:00.000Z",
      slotEnd: "2026-05-07T14:00:00.000Z",
      specialty: "x",
      estimatedRevenueLossUzs: 50_000_000,
    });
    expect(high).toBe("high");
    expect(med).toBe("medium");
  });

  it("dedupe — repeated runs yield identical payloads (same dedupeKey)", async () => {
    const state = {
      doctors: [
        {
          id: "d1",
          nameRu: "Иванов",
          specializationRu: "Кардиолог",
          pricePerVisit: 100_000_00,
          isActive: true,
        },
      ],
      schedules: [
        {
          doctorId: "d1",
          weekday: tomorrowWeekday,
          startTime: "10:00",
          endTime: "12:00",
        },
      ],
      appts: [],
      paid: [],
    };
    const a = await detectEmptySlotTomorrow(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    const b = await detectEmptySlotTomorrow(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });
  // Audit AC-11: a doctor on leave has no free slots to fill.
  const ivanov = {
    id: "d1",
    nameRu: "Иванов",
    specializationRu: "Невролог",
    pricePerVisit: 100_000_00,
    isActive: true,
  };
  const fridayLike = {
    doctorId: "d1",
    weekday: tomorrowWeekday,
    startTime: "09:00",
    endTime: "18:00",
  };

  it("a doctor on leave all day tomorrow gives no free slot", async () => {
    const out = await detectEmptySlotTomorrow(
      makePrisma({
        doctors: [ivanov],
        schedules: [fridayLike],
        appts: [],
        paid: [],
        timeOffs: [
          {
            doctorId: "d1",
            startAt: new Date("2026-05-05T19:00:00.000Z"),
            endAt: new Date("2026-05-10T19:00:00.000Z"),
          },
        ],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("a morning off leaves only the afternoon free", async () => {
    const out = await detectEmptySlotTomorrow(
      makePrisma({
        doctors: [ivanov],
        schedules: [fridayLike],
        appts: [],
        paid: [],
        // 09:00 to 13:00 Tashkent is 04:00 to 08:00 UTC.
        timeOffs: [
          {
            doctorId: "d1",
            startAt: new Date("2026-05-07T04:00:00.000Z"),
            endAt: new Date("2026-05-07T08:00:00.000Z"),
          },
        ],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.slotStart).toBe("2026-05-07T08:00:00.000Z");
    // Peak ends at 18:00 Tashkent = 13:00 UTC: 5 hours.
    expect(out[0]?.slotEnd).toBe("2026-05-07T13:00:00.000Z");
    expect(out[0]?.estimatedRevenueLossUzs).toBe(5 * 100_000_00);
  });

  it("a schedule that ended before tomorrow is not a working day", async () => {
    const out = await detectEmptySlotTomorrow(
      makePrisma({
        doctors: [ivanov],
        schedules: [
          { ...fridayLike, validTo: new Date("2026-04-30T00:00:00.000Z") },
        ],
        appts: [],
        paid: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("a schedule that starts after tomorrow is not a working day", async () => {
    const out = await detectEmptySlotTomorrow(
      makePrisma({
        doctors: [ivanov],
        schedules: [
          { ...fridayLike, validFrom: new Date("2026-05-20T00:00:00.000Z") },
        ],
        appts: [],
        paid: [],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });
});
