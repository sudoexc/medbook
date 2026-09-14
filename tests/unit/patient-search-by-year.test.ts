/**
 * Searching the way the doctor records: «Турматов 1969».
 *
 * He entered ~100 patients with the birth year inside the name field and
 * searches for them the same way. Once the year is lifted into `birthDate`,
 * a name-only search would silently stop finding anyone by year — the habit
 * would break with no error to explain it.
 *
 * This pins the query shape: a trailing year filters on the date range, and
 * when a name precedes it both conditions must hold (otherwise «Турматов 1969»
 * would return every patient born in 1969).
 */
import { describe, expect, it } from "vitest";

const CURRENT_YEAR = 2026;

/** The search branch, extracted in shape from the route. */
function buildWhere(term: string) {
  const where: Record<string, unknown> = {};
  const or: Array<Record<string, unknown>> = [
    { fullName: { contains: term, mode: "insensitive" } },
  ];

  const yearMatch = term.match(/(?:^|\s)((?:19|20)\d{2})\s*$/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (year !== null && year >= 1900 && year <= CURRENT_YEAR) {
    const range = {
      gte: new Date(Date.UTC(year, 0, 1)),
      lt: new Date(Date.UTC(year + 1, 0, 1)),
    };
    const namePart = term.slice(0, yearMatch!.index ?? 0).trim();
    if (namePart) {
      where.AND = [
        { fullName: { contains: namePart, mode: "insensitive" } },
        { birthDate: range },
      ];
    } else {
      or.push({ birthDate: range });
    }
  }
  where.OR = or;
  return where;
}

const RANGE_1969 = {
  gte: new Date(Date.UTC(1969, 0, 1)),
  lt: new Date(Date.UTC(1970, 0, 1)),
};

describe("patient search — year awareness", () => {
  it("«Турматов 1969» requires both the name and the year", () => {
    const w = buildWhere("Турматов 1969");
    expect(w.AND).toEqual([
      { fullName: { contains: "Турматов", mode: "insensitive" } },
      { birthDate: RANGE_1969 },
    ]);
  });

  it("a bare year matches everyone born that year", () => {
    const w = buildWhere("1969");
    expect(w.OR).toContainEqual({ birthDate: RANGE_1969 });
    expect(w.AND).toBeUndefined();
  });

  it("the year range covers the whole year, not just 1 January", () => {
    const w = buildWhere("1969") as { OR: Array<{ birthDate?: typeof RANGE_1969 }> };
    const byDate = w.OR.find((c) => c.birthDate)!.birthDate!;
    expect(byDate.gte.toISOString()).toBe("1969-01-01T00:00:00.000Z");
    expect(byDate.lt.toISOString()).toBe("1970-01-01T00:00:00.000Z");
  });

  it("a plain name search is unchanged", () => {
    const w = buildWhere("Цой Вадим");
    expect(w.AND).toBeUndefined();
    expect(w.OR).toEqual([
      { fullName: { contains: "Цой Вадим", mode: "insensitive" } },
    ]);
  });

  it("ignores a year in the middle — only a trailing year is the habit", () => {
    // «1969 Турматов» is not how he searches; treating it as a year filter
    // would surprise more than it helps.
    expect(buildWhere("1969 Турматов").AND).toBeUndefined();
  });

  it("does not treat a phone number as a year", () => {
    expect(buildWhere("998909038721").AND).toBeUndefined();
  });

  it("ignores a future year", () => {
    expect(buildWhere("Пациент 2099").AND).toBeUndefined();
  });

  it("tolerates trailing whitespace after the year", () => {
    const w = buildWhere("Турматов 1969  ");
    expect(w.AND).toBeDefined();
  });
});
