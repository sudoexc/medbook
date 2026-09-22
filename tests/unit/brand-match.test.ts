import { describe, expect, it } from "vitest";

import { matchedBrand, prescriptionLabel } from "@/lib/catalogs/brand-match";

// Real rows from the state-register import: the clinic types the brand, the
// catalog is keyed by substance.
const tolperisone = {
  nameRu: "Толперизон",
  inn: "tolperisone",
  brands: [{ name: "Мидокалм" }, { name: "Мидокалм® Лонг" }],
};
const vitaminsB = {
  nameRu: "Витамины B1 + B6 + B12",
  brands: [{ name: "Комбилипен" }, { name: "Нейробион" }],
};
const actovegin = {
  nameRu: "Актовегин",
  brands: [{ name: "Актовегин" }],
};

describe("matchedBrand", () => {
  it("returns the brand the doctor typed", () => {
    expect(matchedBrand(tolperisone, "мидокалм")).toBe("Мидокалм");
    expect(matchedBrand(vitaminsB, "нейробион")).toBe("Нейробион");
  });

  it("prefers the exact brand over a longer variant", () => {
    expect(matchedBrand(tolperisone, "мидокал")).toBe("Мидокалм");
    expect(matchedBrand(tolperisone, "мидокалм лонг")).toBe("Мидокалм® Лонг");
  });

  it("returns null when the query is about the substance", () => {
    expect(matchedBrand(tolperisone, "толперизон")).toBeNull();
    expect(matchedBrand(vitaminsB, "витамины")).toBeNull();
  });

  it("ignores registered-trademark noise and case", () => {
    expect(matchedBrand(tolperisone, "МИДОКАЛМ® ЛОНГ")).toBe("Мидокалм® Лонг");
  });

  it("returns null for a too-short or empty query", () => {
    expect(matchedBrand(tolperisone, "м")).toBeNull();
    expect(matchedBrand(tolperisone, "")).toBeNull();
  });
});

describe("prescriptionLabel", () => {
  it("leads with the brand and keeps the substance", () => {
    expect(prescriptionLabel(tolperisone, "мидокалм")).toBe(
      "Мидокалм (толперизон)",
    );
  });

  it("stays plain when the doctor searched the substance", () => {
    expect(prescriptionLabel(tolperisone, "толперизон")).toBe("Толперизон");
  });

  it("does not repeat itself when brand equals the drug name", () => {
    expect(prescriptionLabel(actovegin, "актовегин")).toBe("Актовегин");
  });
});
