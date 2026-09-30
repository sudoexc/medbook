/**
 * Audit PT-17: sorting the patients table by a column.
 *
 * `onSortChange` called `setFilter("sort", …)` and then `setFilter("dir", …)`.
 * Both built the next URL from the same closed-over state, so the second
 * write dropped the first: a click on «Последний визит» left the list sorted
 * by registration date. The two keys now go in one write (`setFilters`).
 *
 * The server half: «Последний визит» is nullable and Postgres puts NULLs
 * first on DESC, so the sort showed never-seen patients on top; and a
 * non-unique sort key without a tiebreaker makes cursor pages repeat or
 * skip rows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { mergeFilters } from "@/app/[locale]/crm/patients/_hooks/use-patients-filters";
import { patientListOrderBy } from "@/server/patient/list-order";

describe("mergeFilters: several keys in one write", () => {
  it("a column click sets sort AND dir, and keeps the other filters", () => {
    const state = { q: "Каримов", sort: "createdAt" as const, dir: "desc" as const };
    expect(mergeFilters(state, { sort: "ltv", dir: "desc" })).toEqual({
      q: "Каримов",
      sort: "ltv",
      dir: "desc",
    });
  });

  it("the old two-step write lost the column; one patch does not", () => {
    const state = { sort: "createdAt" as const, dir: "desc" as const };
    // What the two separate setFilter calls produced: the second one
    // started again from `state`.
    const first = mergeFilters(state, { sort: "lastVisitAt" });
    const second = mergeFilters(state, { dir: "asc" });
    void first;
    expect(second.sort).toBe("createdAt");
    // The fix.
    expect(mergeFilters(state, { sort: "lastVisitAt", dir: "asc" })).toEqual({
      sort: "lastVisitAt",
      dir: "asc",
    });
  });

  it("an empty value drops its key", () => {
    expect(mergeFilters({ q: "x", segment: "ACTIVE" }, { segment: undefined, q: "" })).toEqual(
      {},
    );
  });

  it("the page wires the table's sort to the one-write setter", () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../src/app/[locale]/crm/patients/_components/patients-page-client.tsx",
      ),
      "utf8",
    );
    expect(src).toMatch(/onSortChange=\{\(sort, dir\) => \{[\s\S]*?setFilters\(\{ sort, dir \}\)/);
    expect(src).not.toMatch(/setFilter\("sort"/);
  });
});

describe("patientListOrderBy", () => {
  it("«Последний визит»: never-seen patients last, both directions", () => {
    expect(patientListOrderBy("lastVisitAt", "desc")).toEqual([
      { lastVisitAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(patientListOrderBy("lastVisitAt", "asc")[0]).toEqual({
      lastVisitAt: { sort: "asc", nulls: "last" },
    });
  });

  it("other columns sort plainly, with the id as a stable tiebreaker", () => {
    expect(patientListOrderBy("ltv", "asc")).toEqual([{ ltv: "asc" }, { id: "asc" }]);
    expect(patientListOrderBy("fullName", "desc")).toEqual([
      { fullName: "desc" },
      { id: "desc" },
    ]);
  });
});
