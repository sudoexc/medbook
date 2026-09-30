/**
 * Audit G4-05 — CDS warnings that do not say which drug they are about.
 *
 * An allergy matched on the substance read «Аллергия: мед. Зафиксирована
 * аллергия. Не назначать.» with no drug, and «Один класс ATC: N03AX» named
 * no pair. Equal titles also meant equal keys: React saw duplicate keys and
 * one «Я учёл» struck out every warning with that title.
 *
 * Pinned: every allergy and class warning names its drug or its pair, and
 * no two warnings of one check share a key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cdsWarningKey } from "@/lib/cds-warning-key";

import { cdsState, check, resetCdsState } from "./cds-fixture";

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  return { prisma: makeCdsPrisma() };
});

beforeEach(() => resetCdsState());

const keysOf = (r: Awaited<ReturnType<typeof check>>) => r.warnings.map(cdsWarningKey);

describe("allergy warnings name the drug", () => {
  it("a direct match on the substance", async () => {
    cdsState.allergies = [
      { id: "a1", substance: "Ибупрофен", severity: "SEVERE", reaction: null },
    ];
    const r = await check(["ibuprofen"]);
    const w = r.warnings.filter((x) => x.kind === "ALLERGY");
    expect(w.map((x) => x.title)).toEqual(["Аллергия на «Ибупрофен»: Ибупрофен"]);
  });

  it("one allergy, two drugs: two lines, each with its drug, each its own key", async () => {
    cdsState.allergies = [
      { id: "a1", substance: "пенициллин", severity: "MODERATE", reaction: "крапивница" },
    ];
    const r = await check(["amoxicillin", "amoxiclav"]);
    const w = r.warnings.filter((x) => x.kind === "ALLERGY");
    expect(w.map((x) => x.title).sort()).toEqual([
      "Аллергия на «пенициллин»: Амоксиклав",
      "Аллергия на «пенициллин»: Амоксициллин",
    ]);
    expect(new Set(w.map(cdsWarningKey)).size).toBe(2);
  });
});

describe("class warnings name the pair", () => {
  // Three of one class, one line per pair: cds-duplicate-therapy.test.ts.
  it("no two warnings of a check share a key", async () => {
    cdsState.allergies = [
      { id: "a1", substance: "НПВС", severity: "SEVERE", reaction: null },
    ];
    const r = await check(["ibuprofen", "diclofenac", "nimesulide", "ketorolac"]);
    const keys = keysOf(r);
    expect(r.warnings.length).toBeGreaterThan(3);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the key", () => {
  it("carries the drugs, so equal titles stay apart", () => {
    const base = { kind: "DUPLICATE_CLASS", severity: "MODERATE", title: "t" };
    expect(cdsWarningKey({ ...base, drugA: { id: "a" }, drugB: { id: "b" } })).not.toBe(
      cdsWarningKey({ ...base, drugA: { id: "a" }, drugB: { id: "c" } }),
    );
    expect(cdsWarningKey({ ...base, drugA: { id: "a" } })).toBe("DUPLICATE_CLASS:MODERATE:t:a");
  });
});
