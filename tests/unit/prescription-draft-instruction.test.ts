/**
 * Audit G4-06 — picking a drug copied its reference dosing text for the
 * doctor («Старт…, титровать до…», «Депрессия: …; нейропатическая боль:
 * …») into «Как принимать», and from there into the patient's handout and
 * print, while the collapsed row never showed it.
 *
 * Pinned:
 *   1. A new row from the catalog starts with no instruction, for every
 *      curated drug whatever its reference text says.
 *   2. The handout / print line for carbamazepine, amitriptyline and
 *      topiramate carries none of «Старт», «титровать», «Депрессия:»,
 *      «Эпилепсия:» unless the doctor wrote them.
 *   3. What the doctor writes still reaches the patient, and the collapsed
 *      row of the constructor renders the same line the handout prints.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { draftFromDrug } from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";
import { composeNoteHandout } from "@/server/visit-notes/handout";

import { DRUGS } from "../../prisma/_drug-catalog";
import { DRUG_ENRICHMENT } from "../../prisma/_drug-data";

function catalogDrug(id: string) {
  const d = DRUGS.find((x) => x.id === id)!;
  return {
    id: d.id,
    nameRu: d.nameRu,
    forms: d.forms.map((f) => ({ form: f.form, strengths: f.doses })),
    brands: (d.brands ?? []).map((name) => ({ name })),
    // What the search route returns alongside: the reference text is there,
    // the draft must not use it.
    defaultDosing: DRUG_ENRICHMENT[id]?.defaultDosing ?? null,
  };
}

const REFERENCE_WORDS = /Старт|титровать|Депрессия:|Эпилепсия:/;

describe("a new row starts without the reference text", () => {
  it.each(["carbamazepine", "amitriptyline", "topiramate", "valproate", "warfarin"])(
    "%s",
    (id) => {
      const drug = catalogDrug(id);
      expect(drug.defaultDosing?.adult).toBeTruthy();
      const draft = draftFromDrug(drug);
      expect(draft.instructionRu).toBeNull();
      expect(draft.instructionUz).toBeNull();
    },
  );

  it("holds for every curated drug with reference dosing", () => {
    for (const d of DRUGS) {
      if (!DRUG_ENRICHMENT[d.id]?.defaultDosing?.adult) continue;
      expect(draftFromDrug(catalogDrug(d.id)).instructionRu, d.id).toBeNull();
    }
  });

  it("keeps what the draft is for: name, form, strength", () => {
    const draft = draftFromDrug(catalogDrug("carbamazepine"), "финлепсин");
    expect(draft.drugId).toBe("carbamazepine");
    expect(draft.form).toBe("TAB");
    expect(draft.strength).toBeTruthy();
  });
});

describe("the handout and print", () => {
  it.each(["carbamazepine", "amitriptyline", "topiramate"])(
    "%s: no reference words reach the patient",
    (id) => {
      const draft = draftFromDrug(catalogDrug(id));
      const line = formatPrescriptionLine(draft, "ru", { withInstruction: true });
      expect(line).not.toMatch(REFERENCE_WORDS);
      const handout = composeNoteHandout(
        { patient: { fullName: "Пациент" } },
        {
          diagnosisName: null,
          complaints: [],
          prescriptions: [],
          advice: [],
          followUpNote: null,
          visitPrescriptions: [draft],
        },
        new Date("2026-09-26T08:00:00Z"),
      );
      expect(handout).not.toMatch(REFERENCE_WORDS);
    },
  );

  it("the doctor's own instruction still reaches the patient", () => {
    const draft = {
      ...draftFromDrug(catalogDrug("amitriptyline")),
      instructionRu: "На ночь, не садиться за руль",
    };
    expect(formatPrescriptionLine(draft, "ru", { withInstruction: true })).toContain(
      "На ночь, не садиться за руль",
    );
  });

  it("the collapsed constructor row renders the line with its instruction", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/doctor/reception/_components/prescription-constructor.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("formatPrescriptionLine(row, locale, { withInstruction: true })");
    expect(src).not.toMatch(/defaultDosing/);
  });
});
