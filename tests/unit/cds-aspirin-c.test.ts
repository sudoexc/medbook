/**
 * «АСПИРИН® С» on its registered composition, acetylsalicylic acid +
 * ascorbic acid (REGISTER_COMPOSITION_FIXES): the CDS engine resolves the
 * aspirin in it, so an aspirin allergy and the NSAID rules fire, as they do
 * for the curated aspirin row. On the vitamin C row the import first gave
 * it, both stayed silent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { cdsState, check, registerRow, resetCdsState } from "./cds-fixture";

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  return { prisma: makeCdsPrisma() };
});

const ASPIRIN_C = registerRow(
  "uzr-atsetilsalitsilovaya-kislota-askorbinovaya-kislota",
  "Ацетилсалициловая кислота + аскорбиновая кислота",
  "N02BA51",
  ["АСПИРИН® С"],
);
const VITAMIN_C = registerRow("uzr-askorbinovaya-kislota", "Аскорбиновая кислота", "A11GA01", [
  "МЕР АСКОРБИНОВАЯ КИСЛОТА",
]);

beforeEach(() => {
  resetCdsState();
  cdsState.register = [ASPIRIN_C, VITAMIN_C];
});

describe("АСПИРИН® С is aspirin to the CDS engine", () => {
  it("an aspirin allergy warns, naming the drug", async () => {
    cdsState.allergies = [{ id: "a1", substance: "аспирин", severity: "SEVERE", reaction: "бронхоспазм" }];
    const r = await check([ASPIRIN_C.id]);
    const w = r.warnings.filter((x) => x.kind === "ALLERGY");
    expect(w).toHaveLength(1);
    expect(w[0]!.title).toBe(
      "Аллергия на «аспирин»: Ацетилсалициловая кислота + аскорбиновая кислота",
    );
    expect(w[0]!.severity).toBe("CONTRAINDICATED");
  });

  it("typed as «Аспирин С», it is the same drug", async () => {
    cdsState.allergies = [{ id: "a1", substance: "аспирин", severity: "SEVERE", reaction: null }];
    const r = await check([], { lines: ["Аспирин С 1 таб растворить в стакане воды"] });
    expect(r.resolvedDrugs.map((d) => d.id)).toEqual([ASPIRIN_C.id]);
    expect(r.warnings.some((x) => x.kind === "ALLERGY")).toBe(true);
  });

  it("with another NSAID it warns like aspirin does", async () => {
    const curated = await check(["aspirin", "ketorolac"]);
    const register = await check([ASPIRIN_C.id, "ketorolac"]);
    expect(curated.warnings.length).toBeGreaterThan(0);
    const kinds = (r: typeof curated) => r.warnings.map((w) => `${w.kind}:${w.severity}`).sort();
    expect(kinds(register)).toEqual(kinds(curated));
  });

  it("plain vitamin C stays out of it", async () => {
    cdsState.allergies = [{ id: "a1", substance: "аспирин", severity: "SEVERE", reaction: null }];
    const r = await check([VITAMIN_C.id]);
    expect(r.warnings.filter((x) => x.kind === "ALLERGY")).toEqual([]);
  });
});
