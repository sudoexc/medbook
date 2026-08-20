/**
 * Clinic-day boundary contract — Asia/Tashkent (UTC+5, no DST).
 *
 * Prod runs in UTC while the clinic lives in Tashkent, so «сегодня» must be
 * computed via the Tashkent helpers (`tashkentDayBounds`,
 * `tashkentDayBoundsForDateString`, `tashkentComponents`) and NEVER via
 * server-local `setHours(0,0,0,0)` / `getHours()`. This suite simulates a
 * UTC server (TZ=UTC) and pins the contract:
 *
 *   - the clinic's "today" starts at 19:00 UTC of the *previous* UTC day;
 *   - an appointment at 01:00 Tashkent belongs to the clinic day, even
 *     though its UTC (and server-local) date is still yesterday;
 *   - a browser-sent `date=YYYY-MM-DD` is interpreted as a Tashkent day;
 *   - the HH:MM fallback prints Tashkent wall clock, not server-local.
 *
 * The helpers themselves are TZ-independent (pure UTC arithmetic), so the
 * suite passes identically on a UTC prod box and a UTC+5 dev machine — the
 * TZ override just makes the "server thinks in UTC" contrast explicit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  tashkentComponents,
  toTashkentDate,
} from "@/lib/booking-validation";

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "UTC"; // simulate the prod server
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("tashkentDayBounds — clinic 'today' on a UTC server", () => {
  it("clinic midnight = 19:00 UTC of the previous day", () => {
    // 2026-08-20 10:00 Tashkent (05:00Z) — mid-day, no ambiguity.
    const now = new Date("2026-08-20T05:00:00.000Z");
    const { dayStart, dayEnd } = tashkentDayBounds(now);
    expect(dayStart.toISOString()).toBe("2026-08-19T19:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-08-20T19:00:00.000Z");
  });

  it("00:00–05:00 Tashkent: server's UTC date is still 'yesterday', clinic day is not", () => {
    // 2026-08-19 21:30Z = 2026-08-20 02:30 in Tashkent.
    const nightNow = new Date("2026-08-19T21:30:00.000Z");
    expect(tashkentComponents(nightNow).date).toBe("2026-08-20");
    const { dayStart, dayEnd } = tashkentDayBounds(nightNow);
    expect(dayStart.toISOString()).toBe("2026-08-19T19:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-08-20T19:00:00.000Z");

    // The forbidden server-local pattern lands on a DIFFERENT day start
    // (2026-08-19T00:00Z) — this is exactly the schedule/liveQueue split
    // the doctor saw between midnight and 05:00.
    const serverLocal = new Date(nightNow);
    serverLocal.setHours(0, 0, 0, 0);
    expect(serverLocal.getTime()).not.toBe(dayStart.getTime());
  });

  it("an appointment at 01:00 Tashkent falls inside the clinic day, not the UTC day", () => {
    // Booked for 2026-08-20 01:00 Tashkent → stored as 2026-08-19T20:00Z.
    const appt = toTashkentDate("2026-08-20", "01:00");
    expect(appt.toISOString()).toBe("2026-08-19T20:00:00.000Z");

    const day = tashkentDayBoundsForDateString("2026-08-20");
    expect(appt >= day.dayStart && appt < day.dayEnd).toBe(true);

    // …and it does NOT belong to the previous clinic day.
    const prevDay = tashkentDayBoundsForDateString("2026-08-19");
    expect(appt >= prevDay.dayStart && appt < prevDay.dayEnd).toBe(false);
  });
});

describe("tashkentDayBoundsForDateString — browser `date=YYYY-MM-DD` param", () => {
  it("interprets the string as a Tashkent day, not a server-local one", () => {
    const { dayStart, dayEnd } = tashkentDayBoundsForDateString("2026-08-20");
    expect(dayStart.toISOString()).toBe("2026-08-19T19:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-08-20T19:00:00.000Z");
    // Half-open 24h window.
    expect(dayEnd.getTime() - dayStart.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe("tashkentComponents — HH:MM fallback for Appointment.time", () => {
  it("prints Tashkent wall clock, not the server's UTC clock", () => {
    const appt = new Date("2026-08-19T20:00:00.000Z"); // 01:00 Tashkent
    const comp = tashkentComponents(appt);
    expect(comp.time).toBe("01:00");
    expect(comp.date).toBe("2026-08-20");
    // The forbidden pattern would render the UTC hour instead.
    const serverLocalHHMM = `${String(appt.getHours()).padStart(2, "0")}:${String(
      appt.getMinutes(),
    ).padStart(2, "0")}`;
    expect(serverLocalHHMM).toBe("20:00"); // ← what the bug used to show
    expect(comp.time).not.toBe(serverLocalHHMM);
  });

  it("weekday flips at Tashkent midnight, not UTC midnight", () => {
    // 2026-08-19 20:00Z is a Wednesday in UTC, but already Thursday 01:00
    // in Tashkent — DoctorSchedule.weekday must use the Tashkent dow.
    const d = new Date("2026-08-19T20:00:00.000Z");
    expect(d.getUTCDay()).toBe(3); // Wed (server's view)
    expect(tashkentComponents(d).dow).toBe(4); // Thu (clinic's view)
  });
});
