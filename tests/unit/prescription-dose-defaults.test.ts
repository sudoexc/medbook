/**
 * Audit G4-07 — a catalog pick took the first form and its first
 * «strength» as the dose: insulin went out as «Инсулин гларгин — 100 ЕД/мл»,
 * lactulose as «667 мг/мл», vitamin D3 as «500 МЕ/капля», citicoline always
 * as the injection listed first, acyclovir as the cream. The register lists
 * «200 мг» next to «200мг».
 *
 * Pinned (acceptance):
 *   1. Insulin, lactulose and vitamin D3 start with an EMPTY dose; the
 *      constructor asks for it before the row is saved.
 *   2. Citicoline can be switched to DROPS_ORAL (and starts there, the first
 *      oral form); acyclovir starts as tablets.
 *   3. No curated drug's default dose is a concentration or a pack.
 *   4. No form of the state register lists one strength twice once
 *      normalised («200 мг»/«200мг», «24.0 мг/мл»/«24 мг/мл»).
 *   5. «Мои частые» keep his last form, strength and dose; the clinic's
 *      usual strength brings its own form.
 *   6. (review) A dose equal to a strength that is one ampoule or one
 *      tablet («2 мл» of Мильгамма, «10 мл» of Церебролизин, «1 таб.» of
 *      Панангин) is his dose, kept on every pick; only a concentration or a
 *      pack copied by the old constructor is asked for again.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  draftFromDrug,
  draftFromShortItem,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import type { DrugShortItem } from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";
import {
  defaultDose,
  isConcentrationOrPack,
  isUnitDose,
  normalizeForms,
  normalizeStrength,
  normalizeStrengths,
  withForm,
  withStrength,
} from "@/lib/catalogs/drug-forms";
import { buildDrugShortlist } from "@/server/catalog/shortlist";

import { DRUGS } from "../../prisma/_drug-catalog";
import { DRUGS_EXTRA } from "../../prisma/_drug-catalog-extra";

function catalogDrug(id: string) {
  const d = [...DRUGS, ...DRUGS_EXTRA].find((x) => x.id === id)!;
  return {
    id: d.id,
    nameRu: d.nameRu,
    // As stored: seed-drugs writes `doses` as `strengths`.
    forms: d.forms.map((f) => ({ form: f.form, strengths: f.doses })),
    brands: (d.brands ?? []).map((name) => ({ name })),
  };
}

describe("a pick's default dose (acceptance)", () => {
  it.each(["insulin-glargine", "lactulose", "vitamin_d3"])(
    "%s starts with an empty dose",
    (id) => {
      const draft = draftFromDrug(catalogDrug(id));
      expect(draft.dose).toBe("");
      // The concentration stays the strength: it names the product.
      expect(draft.strength).toBeTruthy();
    },
  );

  it("vitamin D3 starts as its drops, the catalog's first oral form", () => {
    expect(draftFromDrug(catalogDrug("vitamin_d3")).form).toBe("DROPS_ORAL");
  });

  it("citicoline starts oral and can be switched between drops and injection", () => {
    const drug = catalogDrug("citicoline");
    const forms = normalizeForms(drug.forms);
    const draft = draftFromDrug(drug);
    expect(draft.form).toBe("DROPS_ORAL");
    expect(forms.map((f) => f.form)).toEqual(["INJ_IV", "DROPS_ORAL"]);
    const inj = withForm(draft, forms, "INJ_IV");
    expect(inj).toEqual({ form: "INJ_IV", strength: "500 мг/4 мл", dose: "" });
    expect(withForm(inj, forms, "DROPS_ORAL").form).toBe("DROPS_ORAL");
  });

  it("acyclovir starts as tablets, with the tablet as the dose", () => {
    const draft = draftFromDrug(catalogDrug("acyclovir"));
    expect(draft.form).toBe("TAB");
    expect(draft.dose).toBe("200 мг");
  });

  it("a tablet keeps its strength as the dose, as before", () => {
    const draft = draftFromDrug(catalogDrug("carbamazepine"));
    expect(draft.form).toBe("TAB");
    expect(draft.dose).toBe(draft.strength);
  });

  it("no curated drug starts with a concentration or a pack as its dose", () => {
    for (const d of [...DRUGS, ...DRUGS_EXTRA]) {
      const dose = draftFromDrug(catalogDrug(d.id)).dose;
      if (!dose) continue;
      expect(isUnitDose(dose), `${d.id}: «${dose}»`).toBe(true);
      expect(dose, d.id).not.toMatch(/[/%]|мл|флакон|туба|капл/i);
    }
  });
});

describe("a dose the doctor wrote stays his", () => {
  it("another strength moves a default dose, never a written one", () => {
    const tab = { form: "TAB", strength: "200 мг", dose: "200 мг" };
    expect(withStrength(tab, "400 мг").dose).toBe("400 мг");
    expect(withStrength({ ...tab, dose: "1/2 таб" }, "400 мг").dose).toBe("1/2 таб");
  });

  it("only a solid unit with one amount gives a dose", () => {
    expect(defaultDose("TAB", "5 мг")).toBe("5 мг");
    expect(defaultDose("CAP", "2000 МЕ")).toBe("2000 МЕ");
    expect(defaultDose("TAB", "50 мг/12,5 мг")).toBe("");
    expect(defaultDose("SYRUP", "667 мг/мл")).toBe("");
    expect(defaultDose("INJ_SC", "100 ЕД/мл")).toBe("");
    expect(defaultDose("CREAM", "5%")).toBe("");
    expect(defaultDose("DROPS_EAR", "1 флакон")).toBe("");
  });
});

describe("register strengths (acceptance)", () => {
  it("normalises the register's spellings", () => {
    expect(normalizeStrength("200мг")).toBe("200 мг");
    expect(normalizeStrength("24.0 мг/мл")).toBe("24 мг/мл");
    expect(normalizeStrength("2.5 мг")).toBe("2,5 мг");
    expect(normalizeStrength("1мл")).toBe("1 мл");
    expect(normalizeStrengths(["200 мг", "200мг", " ", "24.0 мг/мл", "24 мг/мл"])).toEqual([
      "200 мг",
      "24 мг/мл",
    ]);
  });

  it("no form of the register lists one strength twice", () => {
    const registry = JSON.parse(
      readFileSync(path.join(process.cwd(), "prisma/uzpharm-registry.json"), "utf8"),
    ) as { entities: Array<{ id: string; forms: unknown }> };
    for (const e of registry.entities) {
      for (const f of normalizeForms(e.forms)) {
        const keys = f.strengths.map((s) => s.toLowerCase().replace(/\s+/g, ""));
        expect(new Set(keys).size, `${e.id} ${f.form}`).toBe(keys.length);
      }
    }
  });
});

describe("«Мои частые» and the clinic's core list", () => {
  const citicoline = {
    ...catalogDrug("citicoline"),
    inn: "Citicoline",
    nameUz: null,
    atcCode: "N06BX06",
    category: "NEUROLOGICAL",
    defaultDosing: null,
    rxOnly: true,
    brands: [],
  };
  const item = (over: Partial<DrugShortItem>): DrugShortItem => ({
    key: "citicoline",
    drugId: "citicoline",
    label: "Цераксон",
    count: 5,
    lastDose: null,
    lastForm: null,
    lastStrength: null,
    pinned: false,
    strengths: [],
    drug: citicoline,
    ...over,
  });

  it("his own drug comes back in his last form, strength and dose", () => {
    const { draft } = draftFromShortItem(
      item({ lastDose: "1000 мг", lastForm: "INJ_IV", lastStrength: "1000 мг/4 мл" }),
      "mine",
    );
    expect(draft).toMatchObject({
      displayName: "Цераксон",
      form: "INJ_IV",
      strength: "1000 мг/4 мл",
      dose: "1000 мг",
    });
  });

  it("a concentration the old constructor copied into his dose is not repeated", () => {
    const { draft } = draftFromShortItem(
      item({ lastDose: "500 мг/4 мл", lastForm: "INJ_IV", lastStrength: "500 мг/4 мл" }),
      "mine",
    );
    // His form, but the dose is asked for.
    expect(draft).toMatchObject({ form: "INJ_IV", strength: "500 мг/4 мл", dose: "" });
  });

  it.each([
    ["milgamma", "INJ_IM", "2 мл"],
    ["cerebrolysin", "INJ_IM", "10 мл"],
    ["potassium_mg_asparaginate", "INJ_IV", "10 мл"],
    ["potassium_mg_asparaginate", "TAB", "1 таб."],
  ])("%s %s «%s»: a dose equal to the ampoule or tablet is his and is kept", (id, form, dose) => {
    const { brands: _brands, ...own } = catalogDrug(id);
    const drug = { ...citicoline, ...own };
    const { draft } = draftFromShortItem(
      item({
        key: id,
        drugId: id,
        label: drug.nameRu,
        drug,
        // What the dose prompt saved: the strength of one ampoule or tablet.
        lastDose: dose,
        lastForm: form,
        lastStrength: dose,
      }),
      "mine",
    );
    // Not empty: the constructor does not ask for the dose again.
    expect(draft).toMatchObject({ form, strength: dose, dose });
  });

  it("only a concentration or a pack is not a dose", () => {
    const notDoses = [
      "500 мг/4 мл", "100 ЕД/мл", "20 мг/доза", "5%", "1 флакон", "1 туба 40 г",
      "для небулайзера",
    ];
    for (const s of notDoses) expect(isConcentrationOrPack(s), s).toBe(true);
    const doses = [
      "2 мл", "10 мл", "1 таб.", "500 мг", "5 мл (200 мг)", "400 мг (ретард)",
      "3 г (1 пакет)",
    ];
    for (const s of doses) expect(isConcentrationOrPack(s), s).toBe(false);
  });

  it("the clinic's usual strength brings the form it belongs to", () => {
    const { draft } = draftFromShortItem(item({ strengths: ["100 мг/мл"] }), "clinic");
    expect(draft.form).toBe("DROPS_ORAL");
    expect(draft.strength).toBe("100 мг/мл");
    expect(draft.dose).toBe("");
  });

  it("the shortlist keeps the form and strength of his last dose", () => {
    const d = (s: string) => new Date(s);
    const [row] = buildDrugShortlist({
      pinnedIds: [],
      structured: [
        { drugId: "citicoline", displayName: "Цераксон", dose: "500 мг", form: "DROPS_ORAL", strength: "100 мг/мл", at: d("2026-09-01") },
        { drugId: "citicoline", displayName: "Цераксон", dose: "1000 мг", form: "INJ_IV", strength: "1000 мг/4 мл", at: d("2026-09-20") },
      ],
      freeText: [],
      limit: 10,
    });
    expect(row).toMatchObject({ lastDose: "1000 мг", lastForm: "INJ_IV", lastStrength: "1000 мг/4 мл" });
  });
});

describe("the constructor", () => {
  const src = readFileSync(
    path.join(
      process.cwd(),
      "src/app/[locale]/doctor/reception/_components/prescription-constructor.tsx",
    ),
    "utf8",
  );

  it("never saves a row without a dose: it asks first", () => {
    expect(src).toMatch(/if \(!draft\.dose\.trim\(\)\) \{\s+setPending\(\{ draft, forms, noteId \}\);\s+return;/);
    // Never onto the next patient's note.
    expect(src).toContain("pending.noteId === note.id");
    expect(src).toContain("<PendingDoseForm");
  });

  it("a drawer pick goes through the same step", () => {
    const panel = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/doctor/reception/_components/structured-fields-panel.tsx",
      ),
      "utf8",
    );
    expect(panel).toContain("catalogPickRef.current?.(drug, term)");
    expect(panel).not.toContain("draftFromDrug(drug, term)");
  });
});
