/**
 * Clinic request 29.09.2026: the control visit is «через N дней» (a preset
 * or any typed number) OR the exact day the doctor names.
 *
 * Pinned here, on the pure pieces every reader shares:
 *   1. The due day: an exact date is that day; a count of days is counted
 *      in Tashkent CALENDAR days from the anchor (the signature, else now),
 *      so a visit signed late in the evening lands on the right weekday.
 *   2. Validation: 1..365 days; a date from tomorrow to a year ahead
 *      (Tashkent), today and the past refused, 30 February refused.
 *   3. What a PATCH writes: one mode at a time. A date brings its distance
 *      in days; days clear a date held before; the × clears both.
 *   4. The printed line: «через N дн. · ≈ date» for days, the bare date for
 *      an exact day, in ru and uz.
 *   5. The reception card title drops «~» for an exact day, in ru and uz.
 *   6. A revision records the exact day, and only when there is one.
 *   7. The server's refusal of a date is told apart from other failures.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import IntlMessageFormat from "intl-messageformat";
import { describe, expect, it } from "vitest";

import {
  FOLLOW_UP_MAX_DAYS,
  followUpDateBounds,
  followUpDateKey,
  followUpDateProblem,
  followUpDateValue,
  followUpDayInstant,
  followUpDue,
  formatFollowUpLine,
  isDateKey,
  isFollowUpDays,
  parseFollowUpDays,
  resolveFollowUpWrite,
  tashkentDayDistance,
} from "@/lib/visit-follow-up";
import { formatActionTitle, type Translator } from "@/lib/actions/format";
import type { ActionPayload } from "@/lib/actions/types";
import {
  changedRevisionFields,
  revisionContentOf,
} from "@/server/visit-notes/revisions";
import {
  isFollowUpDateRefused,
  VisitNotePatchError,
} from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";

// 29 Sep 2026, 12:00 Tashkent.
const NOW = new Date("2026-09-29T07:00:00.000Z");
// The DATE column as Prisma returns it: UTC midnight of the day.
const OCT_15 = new Date("2026-10-15T00:00:00.000Z");

describe("the due day", () => {
  it("an exact date is that day, whatever the days say", () => {
    expect(
      followUpDue({ followUpDays: 16, followUpDate: OCT_15 }, NOW, NOW),
    ).toEqual({ date: "2026-10-15", exact: true, days: null });
  });

  it("reads the date as the browser gets it (JSON) and as YYYY-MM-DD", () => {
    for (const value of ["2026-10-15T00:00:00.000Z", "2026-10-15"]) {
      expect(followUpDue({ followUpDate: value }, NOW)?.date).toBe("2026-10-15");
    }
  });

  it("counts days in Tashkent calendar days from the signature", () => {
    // Signed 29 Sep at 23:30 Tashkent: a week on is 6 Oct.
    const late = new Date("2026-09-29T18:30:00.000Z");
    expect(followUpDue({ followUpDays: 7 }, late)).toEqual({
      date: "2026-10-06",
      exact: false,
      days: 7,
    });
    // Signed 30 Sep at 00:30 Tashkent: still 29 Sep in UTC.
    const early = new Date("2026-09-29T19:30:00.000Z");
    expect(followUpDue({ followUpDays: 7 }, early)?.date).toBe("2026-10-07");
  });

  it("a draft counts from now", () => {
    expect(followUpDue({ followUpDays: 14 }, null, NOW)?.date).toBe("2026-10-13");
    expect(followUpDue({ followUpDays: 14 }, undefined, NOW)?.date).toBe(
      "2026-10-13",
    );
  });

  it("no plan, no day", () => {
    expect(followUpDue({}, NOW)).toBeNull();
    expect(followUpDue({ followUpDays: null, followUpDate: null }, NOW)).toBeNull();
    expect(followUpDue({ followUpDays: 0 }, NOW)).toBeNull();
    expect(followUpDue({ followUpDate: "не дата" }, NOW)).toBeNull();
  });

  it("date keys and values round-trip through the DATE column", () => {
    expect(followUpDateKey(OCT_15)).toBe("2026-10-15");
    expect(followUpDateKey(followUpDateValue("2026-10-15"))).toBe("2026-10-15");
    expect(followUpDateKey(null)).toBeNull();
    expect(followUpDateKey("")).toBeNull();
    expect(followUpDateKey(new Date("x"))).toBeNull();
    // Noon Tashkent: the same calendar day in Tashkent and in UTC.
    expect(followUpDayInstant("2026-10-15").toISOString()).toBe(
      "2026-10-15T07:00:00.000Z",
    );
    expect(tashkentDayDistance("2026-09-29", "2026-10-15")).toBe(16);
    expect(tashkentDayDistance("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("validation", () => {
  it("days: whole numbers from 1 to 365", () => {
    expect(isFollowUpDays(1)).toBe(true);
    expect(isFollowUpDays(FOLLOW_UP_MAX_DAYS)).toBe(true);
    for (const bad of [0, -3, 366, 2.5, Number.NaN, "7"]) {
      expect(isFollowUpDays(bad)).toBe(false);
    }
  });

  it("parses what the doctor types in «через [N] дн.»", () => {
    expect(parseFollowUpDays("21")).toBe(21);
    expect(parseFollowUpDays(" 7 ")).toBe(7);
    expect(parseFollowUpDays("365")).toBe(365);
    for (const bad of ["", "0", "366", "1000", "2a", "-5", "1.5", "две"]) {
      expect(parseFollowUpDays(bad)).toBeNull();
    }
  });

  it("a date runs from tomorrow to a year ahead, Tashkent time", () => {
    expect(followUpDateBounds(NOW)).toEqual({
      min: "2026-09-30",
      max: "2027-09-29",
    });
    // 29 Sep 20:00 UTC is already 30 Sep 01:00 in Tashkent.
    expect(followUpDateBounds(new Date("2026-09-29T20:00:00.000Z")).min).toBe(
      "2026-10-01",
    );
  });

  it("refuses today, the past, beyond a year and days that do not exist", () => {
    expect(followUpDateProblem("2026-09-29", NOW)).toBe("past");
    expect(followUpDateProblem("2026-09-01", NOW)).toBe("past");
    expect(followUpDateProblem("2025-10-15", NOW)).toBe("past");
    expect(followUpDateProblem("2027-09-30", NOW)).toBe("too_far");
    expect(followUpDateProblem("2026-02-30", NOW)).toBe("invalid");
    expect(followUpDateProblem("15.10.2026", NOW)).toBe("invalid");
    expect(isDateKey("2026-02-30")).toBe(false);
  });

  it("accepts tomorrow and exactly a year ahead", () => {
    expect(followUpDateProblem("2026-09-30", NOW)).toBeNull();
    expect(followUpDateProblem("2026-10-15", NOW)).toBeNull();
    expect(followUpDateProblem("2027-09-29", NOW)).toBeNull();
  });
});

describe("the refusal the card puts into words", () => {
  it("is told apart from other failures", () => {
    expect(
      isFollowUpDateRefused(
        new VisitNotePatchError(400, "follow_up_date_out_of_range"),
      ),
    ).toBe(true);
    expect(isFollowUpDateRefused(new VisitNotePatchError(400, null))).toBe(false);
    expect(
      isFollowUpDateRefused(new VisitNotePatchError(403, "edit_window_expired")),
    ).toBe(false);
    expect(isFollowUpDateRefused(new Error("x"))).toBe(false);
  });
});

describe("what a PATCH writes", () => {
  it("a date: the day, plus its distance in days for older readers", () => {
    const out = resolveFollowUpWrite(
      // Days sent along are not the doctor's plan: the date is.
      { followUpDate: "2026-10-15", followUpDays: 3 },
      { followUpDate: null },
      NOW,
    );
    expect(out).toEqual({
      ok: true,
      data: { followUpDate: OCT_15, followUpDays: 16 },
    });
  });

  it("a date that is today or past is refused with its reason", () => {
    expect(
      resolveFollowUpWrite({ followUpDate: "2026-09-29" }, {}, NOW),
    ).toEqual({ ok: false, problem: "past" });
    expect(
      resolveFollowUpWrite({ followUpDate: "2027-10-01" }, {}, NOW),
    ).toEqual({ ok: false, problem: "too_far" });
  });

  it("days replace a date held before", () => {
    expect(
      resolveFollowUpWrite({ followUpDays: 21 }, { followUpDate: OCT_15 }, NOW),
    ).toEqual({ ok: true, data: { followUpDays: 21, followUpDate: null } });
  });

  it("days on a note without a date do not touch the date", () => {
    expect(
      resolveFollowUpWrite({ followUpDays: 21 }, { followUpDate: null }, NOW),
    ).toEqual({ ok: true, data: { followUpDays: 21 } });
  });

  it("the × clears both, and only what is there", () => {
    expect(
      resolveFollowUpWrite(
        { followUpDays: null, followUpDate: null },
        { followUpDate: OCT_15 },
        NOW,
      ),
    ).toEqual({ ok: true, data: { followUpDays: null, followUpDate: null } });
    expect(
      resolveFollowUpWrite(
        { followUpDays: null, followUpDate: null },
        { followUpDate: null },
        NOW,
      ),
    ).toEqual({ ok: true, data: { followUpDays: null } });
  });

  it("a save that sends neither leaves both alone", () => {
    expect(resolveFollowUpWrite({}, { followUpDate: OCT_15 }, NOW)).toEqual({
      ok: true,
      data: {},
    });
  });
});

describe("the printed line", () => {
  it("days: «через N дн. · ≈ date»", () => {
    const due = followUpDue({ followUpDays: 14 }, NOW)!;
    expect(formatFollowUpLine(due, "ru")).toBe("через 14 дн. · ≈ 13.10.2026");
    expect(formatFollowUpLine(due, "uz")).toMatch(
      /^14 kundan keyin · ≈ 13\D10\D2026$/,
    );
  });

  it("an exact day: the date alone, no «≈»", () => {
    const due = followUpDue({ followUpDate: OCT_15 }, NOW)!;
    expect(formatFollowUpLine(due, "ru")).toBe("15.10.2026");
    expect(formatFollowUpLine(due, "uz")).toMatch(/^15\D10\D2026$/);
  });
});

describe("the reception card", () => {
  type Tree = { [k: string]: string | Tree };
  const bundles = Object.fromEntries(
    (["ru", "uz"] as const).map((lang) => [
      lang,
      JSON.parse(
        readFileSync(path.join(process.cwd(), `src/messages/${lang}.json`), "utf8"),
      ) as Tree,
    ]),
  ) as Record<"ru" | "uz", Tree>;
  const t =
    (lang: "ru" | "uz"): Translator =>
    (key, values) => {
      const message = key
        .split(".")
        .reduce<string | Tree>((n, k) => (n as Tree)[k]!, bundles[lang]);
      return new IntlMessageFormat(message as string, lang).format(
        values as Record<string, string>,
      ) as string;
    };
  const payload = (exactDate?: boolean): ActionPayload => ({
    type: "VISIT_FOLLOW_UP_DUE",
    visitNoteId: "vn1",
    patientId: "p1",
    patientName: "Рахимов Сардор",
    doctorId: "d1",
    doctorName: "Султанов Азиз",
    dueDate: "2026-10-15",
    followUpNote: "",
    ...(exactDate ? { exactDate } : {}),
  });

  for (const lang of ["ru", "uz"] as const) {
    it(`${lang}: «~» for days, the bare date for an exact day`, () => {
      const estimate = formatActionTitle(t(lang), payload(), lang);
      const exact = formatActionTitle(t(lang), payload(true), lang);
      expect(estimate).toMatch(/~15\D10/);
      expect(exact).not.toContain("~");
      expect(exact).toMatch(/ 15\D10 /);
      expect(exact).toContain("Рахимов Сардор");
    });
  }
});

describe("revisions", () => {
  const base = { followUpDays: 16, followUpNote: null };

  it("record the exact day as YYYY-MM-DD", () => {
    const content = revisionContentOf({ ...base, followUpDate: OCT_15 }, []);
    expect(content.followUpDate).toBe("2026-10-15");
    expect(content.followUpDays).toBe(16);
  });

  it("a «через N дней» note snapshots exactly as before the field", () => {
    const content = revisionContentOf({ ...base, followUpDate: null }, []);
    expect(content).not.toHaveProperty("followUpDate");
  });

  it("switching to a date is a change of the follow-up", () => {
    const before = revisionContentOf({ followUpDays: 7 }, []);
    const after = revisionContentOf({ ...base, followUpDate: OCT_15 }, []);
    expect(changedRevisionFields(before, after)).toEqual([
      "followUpDate",
      "followUpDays",
    ]);
  });
});
