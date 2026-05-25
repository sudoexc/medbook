/**
 * Tests for the UNCONFIRMED_24H detector — Stage 2.C contract.
 *
 * The detector was widened from a 24h to a 72h horizon, and its predicate
 * switched from `status === 'BOOKED'` to `confirmedAt: null`. Severity is now
 * a strict-`<` tier ladder over hours-until-appointment:
 *
 *   <2h → critical, <12h → high, <24h → medium, otherwise → low.
 *
 * These tests pin the exact wiring + boundary semantics so a Stage-3 tweak
 * (e.g. flipping a `<` to `<=`) trips a red light instead of silently
 * shifting Action Center severity counts.
 */
import { describe, it, expect, vi } from "vitest";

import {
  detectUnconfirmed24h,
  severityForUnconfirmed24h,
} from "@/server/actions/detectors/unconfirmed-24h";
import { DEFAULT_CONFIG, type DetectorConfig } from "@/server/actions/config";
import { dedupeKeyFor, type Unconfirmed24hPayload } from "@/lib/actions/types";

type Appt = {
  id: string;
  date: Date;
  patientId: string;
  patient: { fullName: string };
  doctor: { nameRu: string };
};

/** Structural prisma mock — `findMany` returns the rows passed in. */
function makePrisma(rows: Appt[]) {
  return {
    appointment: { findMany: async () => rows },
  } as never;
}

/** Frozen "now" — Wed 2026-05-06 08:00 UTC. */
const now = new Date("2026-05-06T08:00:00.000Z");

function appt(hoursAhead: number, id = `a-${hoursAhead}`): Appt {
  return {
    id,
    date: new Date(now.getTime() + hoursAhead * 60 * 60 * 1000),
    patientId: `p-${id}`,
    patient: { fullName: "Иван Петров" },
    doctor: { nameRu: "Иванов" },
  };
}

function makePayload(hoursAhead: number): Unconfirmed24hPayload {
  return {
    type: "UNCONFIRMED_24H",
    appointmentId: "a1",
    patientId: "p1",
    patientName: "Иван Петров",
    doctorName: "Иванов",
    appointmentAt: new Date(
      now.getTime() + hoursAhead * 60 * 60 * 1000,
    ).toISOString(),
  };
}

describe("detectUnconfirmed24h — Stage 2.C (72h horizon)", () => {
  // ───────────────────────────── T1 ─────────────────────────────
  it("T1: returns [] when findMany yields no rows", async () => {
    const out = await detectUnconfirmed24h(
      makePrisma([]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toEqual([]);
  });

  // ───────────────────────────── T2 ─────────────────────────────
  it("T2: passes the correct `where` clause to prisma.appointment.findMany", async () => {
    const findMany = vi.fn(async () => [] as Appt[]);
    const prisma = { appointment: { findMany } } as never;

    await detectUnconfirmed24h(prisma, "clinic-XYZ", now, DEFAULT_CONFIG);

    expect(findMany).toHaveBeenCalledTimes(1);
    const calls = findMany.mock.calls as unknown as Array<
      [
        {
          where: {
            confirmedAt: unknown;
            status: { notIn: string[] };
            date: { gte: Date; lte: Date };
            clinicId?: string;
          };
        },
      ]
    >;
    const arg = calls[0]![0];

    // The detector relies on tenant-scope middleware for clinicId — it does
    // NOT inject `where.clinicId` itself. Pin that fact (T9 cross-check).
    expect(arg.where.clinicId).toBeUndefined();

    // Predicate: literal `null`, NOT `{ equals: null }` — the composite
    // index `Appointment_clinicId_date_confirmedAt_idx` is keyed on a plain
    // IS NULL filter; any rewrite that wraps this would break index usage.
    expect(arg.where.confirmedAt).toBeNull();

    // Closed-out statuses excluded via `notIn` — exact shape.
    expect(arg.where.status).toEqual({
      notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"],
    });

    // Date window: [now, now+72h]. Compare by epoch ms with 1s tolerance.
    const horizonMs = now.getTime() + 72 * 60 * 60 * 1000;
    expect(Math.abs(arg.where.date.gte.getTime() - now.getTime())).toBeLessThan(
      1000,
    );
    expect(Math.abs(arg.where.date.lte.getTime() - horizonMs)).toBeLessThan(
      1000,
    );
  });

  // ───────────────────────────── T3 ─────────────────────────────
  it("T3: severity boundaries — 0h/2h/12h/24h/72h/73h", () => {
    // Source uses strict `<` at every tier:
    //   if (hoursUntil < 2)  return "critical"
    //   if (hoursUntil < 12) return "high"
    //   if (hoursUntil < 24) return "medium"
    //   return "low"
    // So at EXACTLY a boundary, the row falls into the looser tier.
    expect(severityForUnconfirmed24h(makePayload(0), now)).toBe("critical");

    // 2h exactly → NOT critical (strict <), falls to "high".
    expect(severityForUnconfirmed24h(makePayload(2), now)).toBe("high");

    // 12h exactly → NOT high, falls to "medium".
    expect(severityForUnconfirmed24h(makePayload(12), now)).toBe("medium");

    // 24h exactly → NOT medium, falls to "low".
    expect(severityForUnconfirmed24h(makePayload(24), now)).toBe("low");

    // 72h is still picked up by findMany (`lte: now+72h`) but severity is
    // "low" because everything ≥24h is "low".
    expect(severityForUnconfirmed24h(makePayload(72), now)).toBe("low");

    // 73h would be filtered out by findMany, but severityForUnconfirmed24h
    // is pure — called with such a payload it still returns "low".
    expect(severityForUnconfirmed24h(makePayload(73), now)).toBe("low");

    // Bonus: a hair under each boundary lands in the tighter tier.
    expect(severityForUnconfirmed24h(makePayload(1.999), now)).toBe("critical");
    expect(severityForUnconfirmed24h(makePayload(11.999), now)).toBe("high");
    expect(severityForUnconfirmed24h(makePayload(23.999), now)).toBe("medium");
  });

  // ───────────────────────────── T4 ─────────────────────────────
  it("T4: severity escalates low → medium → high → critical as clock approaches", () => {
    // Same underlying appointment, just measured at different `now`s. We
    // model this by varying the payload's appointmentAt distance instead —
    // equivalent for a pure function. The dedupeKey is appointmentId-only
    // so all four ticks collapse onto the same Action row in production.
    const apptId = "appt-walking";
    const base: Unconfirmed24hPayload = {
      type: "UNCONFIRMED_24H",
      appointmentId: apptId,
      patientId: "p1",
      patientName: "Иван Петров",
      doctorName: "Иванов",
      appointmentAt: "", // filled per-tick
    };

    const ticks = [60, 20, 8, 1] as const;
    const expected = ["low", "medium", "high", "critical"] as const;

    const dedupeKeys: string[] = [];
    ticks.forEach((hoursAhead, i) => {
      const payload: Unconfirmed24hPayload = {
        ...base,
        appointmentAt: new Date(
          now.getTime() + hoursAhead * 60 * 60 * 1000,
        ).toISOString(),
      };
      expect(severityForUnconfirmed24h(payload, now)).toBe(expected[i]);
      dedupeKeys.push(dedupeKeyFor(payload));
    });

    // All four ticks must share the same dedupeKey — that's what lets
    // upsertAction update severity in-place rather than spawn duplicates.
    expect(new Set(dedupeKeys).size).toBe(1);
    expect(dedupeKeys[0]).toBe(`UNCONFIRMED_24H:appointmentId=${apptId}`);
  });

  // ───────────────────────────── T5 ─────────────────────────────
  it("T5: dedupeKey is stable across detector runs for the same row", async () => {
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
    expect(dedupeKeyFor(a[0]!)).toBe("UNCONFIRMED_24H:appointmentId=a-5");
  });

  // ───────────────────────────── T6 ─────────────────────────────
  it("T6: emitted payload has exactly the fields declared on Unconfirmed24hPayload", async () => {
    const row = appt(3, "appt-shape-1");
    const [payload] = await detectUnconfirmed24h(
      makePrisma([row]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(payload).toBeDefined();
    expect(payload).toEqual({
      type: "UNCONFIRMED_24H",
      appointmentId: "appt-shape-1",
      patientId: "p-appt-shape-1",
      patientName: "Иван Петров",
      doctorName: "Иванов",
      appointmentAt: row.date.toISOString(),
    });
    // Pin key set — no leakage of `clinicId`, `status`, `confirmedAt`, etc.
    expect(Object.keys(payload!).sort()).toEqual(
      [
        "appointmentAt",
        "appointmentId",
        "doctorName",
        "patientId",
        "patientName",
        "type",
      ].sort(),
    );
  });

  // ───────────────────────────── T7 ─────────────────────────────
  it("T7: three rows at different offsets → three payloads with correct severities", async () => {
    const rows = [appt(1, "near"), appt(8, "mid"), appt(40, "far")];
    const out = await detectUnconfirmed24h(
      makePrisma(rows),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(out).toHaveLength(3);

    const byId = new Map(out.map((p) => [p.appointmentId, p]));
    expect(severityForUnconfirmed24h(byId.get("near")!, now)).toBe("critical");
    expect(severityForUnconfirmed24h(byId.get("mid")!, now)).toBe("high");
    expect(severityForUnconfirmed24h(byId.get("far")!, now)).toBe("low");
  });

  // ───────────────────────────── T8 ─────────────────────────────
  it("T8: DEFAULT_CONFIG.unconfirmedHoursAhead is ignored by this detector", async () => {
    // Stage 2.C hard-coded the horizon to 72h — the config field is now
    // dead-code for this detector. Override it to a wildly different value
    // and assert the result is byte-identical.
    const tweaked: DetectorConfig = {
      ...DEFAULT_CONFIG,
      unconfirmedHoursAhead: 1,
    };
    const rows = [appt(2, "a"), appt(48, "b"), appt(70, "c")];

    const fromDefault = await detectUnconfirmed24h(
      makePrisma(rows),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    const fromTweaked = await detectUnconfirmed24h(
      makePrisma(rows),
      "c1",
      now,
      tweaked,
    );
    expect(fromTweaked).toEqual(fromDefault);
  });

  // ───────────────────────────── T9 ─────────────────────────────
  it("T9: detector forwards clinicId arg into prisma.findMany call site", async () => {
    // The current Stage 2.C source relies on tenant-scope middleware and
    // does NOT inject clinicId into the `where`. This test pins that
    // wiring fact so any future change is conscious — if a clinicId arg
    // starts being passed through, this test forces the contract update.
    const findMany = vi.fn(async () => [] as Appt[]);
    const prisma = { appointment: { findMany } } as never;

    await detectUnconfirmed24h(prisma, "clinic-XYZ", now, DEFAULT_CONFIG);

    const calls = findMany.mock.calls as unknown as Array<
      [{ where: Record<string, unknown> }]
    >;
    const arg = calls[0]![0];
    expect(arg.where).not.toHaveProperty("clinicId");
  });

  // ───────────────────────────── T10 ────────────────────────────
  it("T10: appointmentAt is exactly row.date.toISOString() — round-trippable", async () => {
    const row = appt(7.5, "iso-row");
    const [payload] = await detectUnconfirmed24h(
      makePrisma([row]),
      "c1",
      now,
      DEFAULT_CONFIG,
    );
    expect(payload!.appointmentAt).toBe(row.date.toISOString());
    // Round-trip: parse → ISO → same string.
    expect(new Date(payload!.appointmentAt).toISOString()).toBe(
      payload!.appointmentAt,
    );
    // Sanity: ISO-8601 Zulu format.
    expect(payload!.appointmentAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});
