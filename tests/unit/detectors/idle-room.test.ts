/**
 * Tests for the IDLE_ROOM detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - cabinet idle ≥ threshold + clinic queue > 0 → one payload
 *   - cabinet has IN_PROGRESS appt → suppressed
 *   - clinic queue empty → no payloads even if cabinets idle
 *   - dedupe — repeated runs yield identical payloads
 */
import { describe, it, expect } from "vitest";

import { detectIdleRoom } from "@/server/actions/detectors/idle-room";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor } from "@/lib/actions/types";

type Cabinet = {
  id: string;
  number: string;
  nameRu: string | null;
  isActive: boolean;
};
type Appt = {
  cabinetId: string | null;
  status: string;
  date: Date;
  endDate: Date;
};

function makePrisma(state: { cabinets: Cabinet[]; appts: Appt[] }) {
  return {
    cabinet: { findMany: async () => state.cabinets },
    appointment: { findMany: async () => state.appts },
  } as never;
}

const now = new Date("2026-05-06T11:00:00.000Z");

describe("detectIdleRoom", () => {
  it("returns [] when there are no cabinets", async () => {
    const out = await detectIdleRoom(
      makePrisma({ cabinets: [], appts: [] }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("returns [] when clinic queue is empty even if cabinets are idle", async () => {
    const lastEnd = new Date(now.getTime() - 30 * 60_000);
    const out = await detectIdleRoom(
      makePrisma({
        cabinets: [
          { id: "cab1", number: "101", nameRu: "Кабинет 1", isActive: true },
        ],
        appts: [
          {
            cabinetId: "cab1",
            status: "COMPLETED",
            date: new Date(lastEnd.getTime() - 30 * 60_000),
            endDate: lastEnd,
          },
        ],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits payload for idle cabinet when queue exists", async () => {
    const lastEnd = new Date(now.getTime() - 30 * 60_000);
    const out = await detectIdleRoom(
      makePrisma({
        cabinets: [
          { id: "cab1", number: "101", nameRu: "Кабинет 1", isActive: true },
        ],
        appts: [
          {
            cabinetId: "cab1",
            status: "COMPLETED",
            date: new Date(lastEnd.getTime() - 30 * 60_000),
            endDate: lastEnd,
          },
          {
            // Someone is waiting clinic-wide → fan out the idle alert.
            cabinetId: null,
            status: "WAITING",
            date: now,
            endDate: now,
          },
        ],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("IDLE_ROOM");
    expect(out[0]?.cabinetId).toBe("cab1");
    expect(out[0]?.cabinetName).toBe("Кабинет 1");
    expect(out[0]?.idleMinutes).toBe(30);
    expect(out[0]?.queueLength).toBe(1);
  });

  it("suppresses cabinet that has an IN_PROGRESS appt", async () => {
    const lastEnd = new Date(now.getTime() - 30 * 60_000);
    const out = await detectIdleRoom(
      makePrisma({
        cabinets: [
          { id: "cab1", number: "101", nameRu: "Кабинет 1", isActive: true },
        ],
        appts: [
          {
            cabinetId: "cab1",
            status: "IN_PROGRESS",
            date: new Date(lastEnd.getTime() - 30 * 60_000),
            endDate: now,
          },
          {
            cabinetId: null,
            status: "WAITING",
            date: now,
            endDate: now,
          },
        ],
      }),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("dedupe — repeated runs yield identical payloads", async () => {
    const lastEnd = new Date(now.getTime() - 30 * 60_000);
    const state = {
      cabinets: [
        { id: "cab1", number: "101", nameRu: "Кабинет 1", isActive: true },
      ],
      appts: [
        {
          cabinetId: "cab1",
          status: "COMPLETED",
          date: new Date(lastEnd.getTime() - 30 * 60_000),
          endDate: lastEnd,
        },
        {
          cabinetId: null,
          status: "WAITING",
          date: now,
          endDate: now,
        },
      ],
    };
    const a = await detectIdleRoom(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    const b = await detectIdleRoom(makePrisma(state), "c1", now, DEFAULT_CONFIG);
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });
});
