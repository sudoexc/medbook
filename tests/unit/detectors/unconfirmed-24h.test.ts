/**
 * Tests for the UNCONFIRMED_24H detector.
 *
 * Verifies:
 *   - empty input → empty array
 *   - BOOKED appt within 24h → one payload
 *   - severity scales by hours-until-appt (high <2h, medium <12h, low ≥12h)
 *   - dedupe — repeated runs yield identical payloads
 */
import { describe, it, expect } from "vitest";

import {
  detectUnconfirmed24h,
  severityForUnconfirmed24h,
} from "@/server/actions/detectors/unconfirmed-24h";
import { DEFAULT_CONFIG } from "@/server/actions/config";
import { dedupeKeyFor, type Unconfirmed24hPayload } from "@/lib/actions/types";

type Appt = {
  id: string;
  date: Date;
  patientId: string;
  patient: { fullName: string };
  doctor: { nameRu: string };
};

function makePrisma(rows: Appt[]) {
  return {
    appointment: { findMany: async () => rows },
  } as never;
}

const now = new Date("2026-05-06T08:00:00.000Z");

function appt(hoursAhead: number): Appt {
  return {
    id: `a-${hoursAhead}`,
    date: new Date(now.getTime() + hoursAhead * 60 * 60 * 1000),
    patientId: "p1",
    patient: { fullName: "Иван Петров" },
    doctor: { nameRu: "Иванов" },
  };
}

describe("detectUnconfirmed24h", () => {
  it("returns [] when there are no booked appts", async () => {
    const out = await detectUnconfirmed24h(
      makePrisma([]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  it("emits one payload per booked appt in the next 24h", async () => {
    const out = await detectUnconfirmed24h(
      makePrisma([appt(1), appt(10), appt(20)]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.type).toBe("UNCONFIRMED_24H");
    expect(out[0]?.appointmentId).toBe("a-1");
    expect(out[0]?.patientName).toBe("Иван Петров");
    expect(out[0]?.doctorName).toBe("Иванов");
  });

  it("severity scales with hours-until-appt", () => {
    const make = (hoursAhead: number): Unconfirmed24hPayload => ({
      type: "UNCONFIRMED_24H",
      appointmentId: "a1",
      patientId: "p1",
      patientName: "x",
      doctorName: "y",
      appointmentAt: new Date(
        now.getTime() + hoursAhead * 60 * 60 * 1000,
      ).toISOString(),
    });
    expect(severityForUnconfirmed24h(make(1), now)).toBe("high");
    expect(severityForUnconfirmed24h(make(6), now)).toBe("medium");
    expect(severityForUnconfirmed24h(make(20), now)).toBe("low");
  });

  it("dedupe — running twice yields identical payloads", async () => {
    const rows = [appt(5)];
    const a = await detectUnconfirmed24h(
      makePrisma(rows),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    const b = await detectUnconfirmed24h(
      makePrisma(rows),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(a).toEqual(b);
    expect(dedupeKeyFor(a[0]!)).toBe(dedupeKeyFor(b[0]!));
  });
});
