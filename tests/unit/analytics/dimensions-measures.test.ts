/**
 * Phase 18 Wave 1 — dimensions + measures catalog sanity.
 *
 * Asserts that each dimension and measure has unique alias + key, and the
 * SQL fragments reference table aliases the query-builder always provides
 * (`a` for Appointment, `p` for Patient, `d` for Doctor).
 */
import { describe, it, expect } from "vitest";

import {
  DIMENSIONS,
  DIMENSION_KEYS,
  isDimensionKey,
} from "@/server/analytics/dimensions";
import {
  MEASURES,
  MEASURE_KEYS,
  isMeasureKey,
} from "@/server/analytics/measures";

describe("DIMENSIONS catalog", () => {
  it("declares every key in DIMENSION_KEYS", () => {
    for (const k of DIMENSION_KEYS) {
      expect(DIMENSIONS[k]).toBeDefined();
      expect(DIMENSIONS[k].key).toBe(k);
    }
  });

  it("aliases are unique", () => {
    const aliases = DIMENSION_KEYS.map((k) => DIMENSIONS[k].alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("isDimensionKey type guard rejects unknown keys", () => {
    expect(isDimensionKey("doctor")).toBe(true);
    expect(isDimensionKey("nope")).toBe(false);
  });

  it("only references the canonical aliases (a / p / d)", () => {
    for (const k of DIMENSION_KEYS) {
      const sql = DIMENSIONS[k].sql;
      // No bare table names — only aliased forms.
      expect(sql).not.toMatch(/Appointment\."/);
      expect(sql).not.toMatch(/Patient\."/);
      expect(sql).not.toMatch(/Doctor\."/);
    }
  });
});

describe("MEASURES catalog", () => {
  it("declares every key in MEASURE_KEYS", () => {
    for (const k of MEASURE_KEYS) {
      expect(MEASURES[k]).toBeDefined();
      expect(MEASURES[k].key).toBe(k);
    }
  });

  it("aliases are unique", () => {
    const aliases = MEASURE_KEYS.map((k) => MEASURES[k].alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("each measure SQL is an aggregate (contains SUM, AVG, COUNT, or CASE)", () => {
    for (const k of MEASURE_KEYS) {
      const sql = MEASURES[k].sql;
      expect(sql).toMatch(/\bSUM\b|\bAVG\b|\bCOUNT\b|CASE\b/);
    }
  });

  it("isMeasureKey type guard rejects unknown keys", () => {
    expect(isMeasureKey("count_visits")).toBe(true);
    expect(isMeasureKey("nope")).toBe(false);
  });
});
