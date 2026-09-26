/**
 * Audit CD-03: printed times in the clinic's wall-clock, whatever zone the
 * server process runs in.
 *
 * Production runs UTC (no TZ in the Dockerfiles). `formatDate` built its
 * short / long / time formatters without `timeZone`, so the conclusion print
 * stamped «Дата финализации 23.09.2026 10:10» for a note signed at 15:10 in
 * Tashkent, amendments made after midnight landed on the previous day, and
 * the public sick-leave check said «действует сегодня» at 02:00 for a
 * certificate that ended the day before.
 *
 * The process zone is forced to UTC here (and then to a zone on the other
 * side of the world) to prove the output no longer depends on it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatDate } from "@/lib/format";
import { composePatientHandout } from "@/lib/catalogs/handout-composer";
import { sickLeaveInEffectOn } from "@/server/clinical-forms/sick-leave-effect";

const ORIGINAL_TZ = process.env.TZ;

/** 15:10 on 23.09.2026 in Tashkent. */
const SIGNED = new Date("2026-09-23T10:10:00Z");
/** 01:30 on 24.09.2026 in Tashkent, still 23.09 in UTC. */
const AFTER_MIDNIGHT = new Date("2026-09-23T20:30:00Z");

function withProcessZone(tz: string) {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
}

describe.each(["UTC", "America/New_York"])(
  "formatDate with the process in %s",
  (tz) => {
    withProcessZone(tz);

    it("the process really is in that zone (guards the test itself)", () => {
      const offset = SIGNED.getTimezoneOffset();
      expect(offset).toBe(tz === "UTC" ? 0 : 240);
    });

    it("time: a note signed at 15:10 in Tashkent prints 15:10", () => {
      expect(formatDate(SIGNED, "ru", "time")).toBe("15:10");
      expect(formatDate(SIGNED, "uz", "time")).toBe("15:10");
    });

    it("short: an amendment at 01:30 lands on the clinic's day, not UTC's", () => {
      expect(formatDate(AFTER_MIDNIGHT, "ru", "short")).toBe("24.09.2026");
      expect(formatDate(AFTER_MIDNIGHT, "ru", "time")).toBe("01:30");
    });

    it("long and dayMonthTime use the clinic's day too", () => {
      expect(formatDate(AFTER_MIDNIGHT, "ru", "long")).toBe("24 сентября 2026 г.");
      expect(formatDate(AFTER_MIDNIGHT, "ru", "dayMonthTime")).toBe(
        "24 сентября, 01:30",
      );
    });

    it("a date-only column (UTC midnight) keeps its calendar date", () => {
      // Birth dates and sick-leave periods are @db.Date: stored as 00:00Z.
      const birth = new Date("1990-05-10T00:00:00.000Z");
      expect(formatDate(birth, "ru", "short")).toBe("10.05.1990");
    });

    it("the patient handout names the clinic's day for the visit", () => {
      const md = composePatientHandout({
        locale: "ru",
        visitDate: AFTER_MIDNIGHT,
        diagnosisName: "Мигрень",
      });
      expect(md).toContain("24 сентября 2026");
      const uz = composePatientHandout({
        locale: "uz",
        visitDate: AFTER_MIDNIGHT,
        diagnosisName: "Migren",
      });
      expect(uz).toContain("2026-yil 24-sentyabr");
    });
  },
);

describe("public sick-leave check: «действует сегодня» by the clinic's calendar", () => {
  withProcessZone("UTC");

  const sl = {
    status: "ISSUED",
    periodFrom: new Date("2026-09-20T00:00:00.000Z"),
    periodTo: new Date("2026-09-23T00:00:00.000Z"),
  };

  it("at 02:00 on 24.09 in Tashkent a certificate that ended on 23.09 is over", () => {
    // 21:00Z on 23.09: the UTC day is still the 23rd.
    expect(sickLeaveInEffectOn(sl, new Date("2026-09-23T21:00:00Z"))).toBe(false);
  });

  it("at 23:00 on 23.09 in Tashkent it is still in effect", () => {
    expect(sickLeaveInEffectOn(sl, new Date("2026-09-23T18:00:00Z"))).toBe(true);
  });

  it("a certificate starting on 24.09 is in effect from 00:30 Tashkent time", () => {
    const next = {
      ...sl,
      periodFrom: new Date("2026-09-24T00:00:00.000Z"),
      periodTo: new Date("2026-09-26T00:00:00.000Z"),
    };
    expect(sickLeaveInEffectOn(next, new Date("2026-09-23T19:30:00Z"))).toBe(true);
  });

  it("a cancelled certificate is never in effect", () => {
    expect(
      sickLeaveInEffectOn(
        { ...sl, status: "CANCELLED" },
        new Date("2026-09-22T06:00:00Z"),
      ),
    ).toBe(false);
  });
});
