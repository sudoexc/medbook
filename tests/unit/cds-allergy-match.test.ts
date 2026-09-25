/**
 * Audit G4-02 — allergy matching by substance and class, not raw substring.
 *
 * Acceptance from the audit card:
 *   - «пенициллин» warns on amoxicillin, Амоксиклав, ampicillin, sultamicillin;
 *   - «Амоксициллин» warns on Амоксиклав;
 *   - «аспирин» or «НПВС» warns on ibuprofen and diclofenac;
 *   - «мед» (honey) does not warn on azithromycin (Сумамед) or warfarin.
 * Drug rows mirror the static catalog (prisma/_drug-catalog*.ts) and the
 * registry brands the audit quoted («Мокси», «Медаксон®»).
 */
import { describe, expect, it } from "vitest";

import { matchAllergy, type AllergyDrug } from "@/server/cds/allergy-match";

const D: Record<string, AllergyDrug> = {
  amoxicillin: { id: "amoxicillin", inn: "Amoxicillin", nameRu: "Амоксициллин", atcCode: "J01CA04", brandNames: ["Флемоксин Солютаб"] },
  amoxiclav: { id: "amoxiclav", inn: "Amoxicillin + Clavulanate", nameRu: "Амоксиклав", atcCode: "J01CR02", brandNames: ["Аугментин", "Флемоклав"] },
  ampicillin: { id: "ampicillin", inn: "Ampicillin", nameRu: "Ампициллин", atcCode: null, brandNames: ["Ампициллин"] },
  sultamicillin: { id: "sultamicillin", inn: "Sultamicillin", nameRu: "Сультамициллин", atcCode: null, brandNames: ["Уназин"] },
  ibuprofen: { id: "ibuprofen", inn: "Ibuprofen", nameRu: "Ибупрофен", atcCode: "M01AE01", brandNames: ["Нурофен", "Адвил", "МИГ"] },
  diclofenac: { id: "diclofenac", inn: "Diclofenac", nameRu: "Диклофенак", atcCode: "M01AB05", brandNames: ["Вольтарен"] },
  azithromycin: { id: "azithromycin", inn: "Azithromycin", nameRu: "Азитромицин", atcCode: "J01FA10", brandNames: ["Сумамед", "Зитромакс"] },
  warfarin: { id: "warfarin", inn: "Warfarin", nameRu: "Варфарин", atcCode: "B01AA03", brandNames: ["Варфарин Никомед", "Варфарекс"] },
  thiocolchicoside: { id: "thiocolchicoside", inn: "Thiocolchicoside", nameRu: "Тиоколхикозид", atcCode: null, brandNames: ["Мускомед", "Миорикс"] },
  ceftriaxone: { id: "uzr-ceftriaxone", inn: "Ceftriaxone", nameRu: "Цефтриаксон", atcCode: "J01DD04", brandNames: ["Медаксон®"] },
  moxifloxacin: { id: "moxifloxacin", inn: "Moxifloxacin", nameRu: "Моксифлоксацин", atcCode: "J01MA14", brandNames: ["Авелокс", "Мокси"] },
  aspirinCardio: { id: "aspirin_cardio", inn: "aspirin_cardio", nameRu: "Ацетилсалициловая кислота кардио", atcCode: "B01AC06", brandNames: ["Кардиомагнил", "Аспирин Кардио"] },
  oxcarbazepine: { id: "oxcarbazepine", inn: "Oxcarbazepine", nameRu: "Окскарбазепин", atcCode: null, brandNames: ["Трилептал"] },
  paracetamol: { id: "paracetamol", inn: "Paracetamol", nameRu: "Парацетамол", atcCode: "N02BE01", brandNames: ["Панадол"] },
  otipax: { id: "otipax", inn: "otipax", nameRu: "Лидокаин + феназон", atcCode: "S02DA30", brandNames: ["Отипакс"] },
};

const hits = (allergy: string, drug: AllergyDrug) => matchAllergy(allergy, drug) !== null;

describe("penicillin class", () => {
  it("«пенициллин» reaches every penicillin, whatever its name", () => {
    for (const d of [D.amoxicillin, D.amoxiclav, D.ampicillin, D.sultamicillin]) {
      expect(hits("пенициллин", d), d.id).toBe(true);
    }
    expect(hits("Пенициллины (отёк Квинке)", D.amoxiclav)).toBe(true);
  });

  it("«Амоксициллин (крапивница)» reaches Амоксиклав and ampicillin", () => {
    expect(hits("Амоксициллин (крапивница)", D.amoxicillin)).toBe(true);
    expect(hits("Амоксициллин (крапивница)", D.amoxiclav)).toBe(true);
    expect(hits("Амоксициллин", D.ampicillin)).toBe(true);
  });

  it("an amoxicillin allergy does not fire on moxifloxacin via the brand «Мокси»", () => {
    expect(hits("Амоксициллин", D.moxifloxacin)).toBe(false);
  });
});

describe("NSAIDs and aspirin", () => {
  it("«аспирин» and «НПВС» reach ibuprofen and diclofenac", () => {
    for (const allergy of ["аспирин", "НПВС", "Аспирин (бронхоспазм)"]) {
      expect(hits(allergy, D.ibuprofen), allergy).toBe(true);
      expect(hits(allergy, D.diclofenac), allergy).toBe(true);
    }
    expect(hits("ацетилсалициловая кислота", D.aspirinCardio)).toBe(true);
  });

  it("does not spill over to paracetamol", () => {
    expect(hits("НПВС", D.paracetamol)).toBe(false);
    expect(hits("аспирин", D.paracetamol)).toBe(false);
  });
});

describe("food allergies and short words do not block drugs", () => {
  it("«мед» / «мёд» matches none of Сумамед, варфарин, Мускомед, Медаксон", () => {
    for (const allergy of ["мед", "мёд", "Мед (сыпь)"]) {
      for (const d of [D.azithromycin, D.warfarin, D.thiocolchicoside, D.ceftriaxone]) {
        expect(hits(allergy, d), `${allergy} vs ${d.id}`).toBe(false);
      }
    }
  });

  it("brands of three letters are never matched («МИГ»)", () => {
    expect(hits("миг", D.ibuprofen)).toBe(false);
  });

  it("a questionnaire «нет» matches nothing", () => {
    for (const d of Object.values(D)) expect(hits("нет", d)).toBe(false);
  });
});

describe("same substance, other spellings", () => {
  it("brand and inflected names still match", () => {
    expect(hits("Нурофен", D.ibuprofen)).toBe(true);
    expect(hits("на ибупрофен", D.ibuprofen)).toBe(true);
    expect(hits("Ibuprofen", D.ibuprofen)).toBe(true);
    expect(hits("цефтриаксону", D.ceftriaxone)).toBe(true);
  });

  it("carbamazepine allergy warns on oxcarbazepine (SmPC cross-reactivity)", () => {
    const m = matchAllergy("Карбамазепин (сыпь)", D.oxcarbazepine);
    expect(m?.kind).toBe("CLASS");
  });

  it("a component of a combination is found («лидокаин» → Отипакс)", () => {
    expect(hits("лидокаин", D.otipax)).toBe(true);
  });

  it("reports a class match with the group, and whether the class was named", () => {
    const named = matchAllergy("пенициллин", D.amoxiclav);
    expect(named).toMatchObject({ kind: "CLASS", namedClass: true });
    const viaMember = matchAllergy("Амоксициллин", D.amoxiclav);
    expect(viaMember).toMatchObject({ kind: "CLASS", namedClass: false });
    if (viaMember?.kind === "CLASS") expect(viaMember.cls.labelRu).toBe("пенициллины");
    expect(matchAllergy("Амоксициллин", D.amoxicillin)?.kind).toBe("SUBSTANCE");
  });
});
