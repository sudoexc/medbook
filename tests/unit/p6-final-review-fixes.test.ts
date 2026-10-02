/**
 * P6 final pre-deploy review.
 *
 * G4-21 follow-up: the catalog extension's copies (levodopa-carbidopa,
 * potassium-magnesium-asparaginate) carry no ATC code, so their id is the
 * only way a course picked from the copy card reaches its CDS class. They
 * stay live rows until scripts/fix-g4-21-duplicate-drugs.ts runs with
 * APPLY=1, so the class lists must keep them until then:
 *   1. every copy is in each rule side and in the long-term set exactly
 *      where its curated row (with the curated ATC) is;
 *   2. spironolactone with a Панангин course picked from the copy still
 *      warns about hyperkalemia;
 *   3. metoclopramide or haloperidol with a Наком course picked from the
 *      copy still warn, and that open-ended course still counts as long
 *      term therapy three months on.
 */
import { describe, expect, it } from "vitest";

import { DRUG_ENRICHMENT } from "../../prisma/_drug-data";
import { DUPLICATE_DRUGS } from "../../scripts/_drug-duplicates";
import {
  LONG_TERM_THERAPY,
  isCourseCurrent,
  isLongTermTherapy,
} from "@/server/cds/current-therapy";
import {
  INTERACTION_RULES,
  drugInClass,
  findRuleInteractions,
  type RuleDrug,
} from "@/server/cds/interaction-rules";

const copy = (id: string): RuleDrug => ({ id, atcCode: null });
const curated = (id: string): RuleDrug => ({
  id,
  atcCode: DRUG_ENRICHMENT[id]?.atcCode ?? null,
});
const ruleKeys = (drugs: RuleDrug[]) =>
  findRuleInteractions(drugs).map((h) => h.rule.key);

describe("G4-21 follow-up: a copy keeps its curated row's classes", () => {
  it.each(DUPLICATE_DRUGS.map((d) => [d.from, d.to]))(
    "%s matches every class %s matches",
    (from, to) => {
      const c = copy(from);
      const k = curated(to);
      for (const rule of INTERACTION_RULES) {
        expect([rule.key, "a", drugInClass(c, rule.a)]).toEqual([
          rule.key,
          "a",
          drugInClass(k, rule.a),
        ]);
        expect([rule.key, "b", drugInClass(c, rule.b)]).toEqual([
          rule.key,
          "b",
          drugInClass(k, rule.b),
        ]);
      }
      expect(drugInClass(c, LONG_TERM_THERAPY)).toBe(
        drugInClass(k, LONG_TERM_THERAPY),
      );
    },
  );

  it("spironolactone + Панангин picked from the copy card warns", () => {
    expect(
      ruleKeys([copy("spironolactone"), copy("potassium-magnesium-asparaginate")]),
    ).toContain("potassium-sparing+potassium");
    expect(
      ruleKeys([copy("spironolactone"), curated("potassium_mg_asparaginate")]),
    ).toContain("potassium-sparing+potassium");
  });

  it("metoclopramide or haloperidol + Наком picked from the copy card warns", () => {
    const nakom = copy("levodopa-carbidopa");
    expect(ruleKeys([copy("metoclopramide"), nakom])).toContain(
      "metoclopramide+dopaminergic",
    );
    expect(ruleKeys([copy("haloperidol"), nakom])).toContain(
      "d2-antipsychotic+dopaminergic",
    );
  });

  it("an open-ended Наком course from the copy card is long-term therapy", () => {
    const nakom = copy("levodopa-carbidopa");
    expect(isLongTermTherapy([nakom])).toBe(true);
    const now = new Date("2026-10-02T09:00:00Z");
    const course = {
      status: "ACTIVE",
      schedule: null,
      createdAt: new Date("2026-07-01T09:00:00Z"),
    };
    expect(isCourseCurrent(course, now, isLongTermTherapy([nakom]))).toBe(true);
  });
});
