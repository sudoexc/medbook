/**
 * Tests for the EMPTY_SLOT_TOMORROW detector.
 *
 * Mocks Prisma's findMany calls and verifies:
 *   - empty input → empty array
 *   - peak-hour gap → one payload with correct slot timing
 *   - severity rule (>1M UZS = high)
 *   - dedupe — running twice yields identical payloads
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
};
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
}) {
  return {
    doctor: { findMany: async () => state.doctors },
    doctorSchedule: { findMany: async () => state.schedules },
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
});
