import { describe, expect, it } from "vitest";

import { ICD10_ENTRIES } from "@/server/icd10/data";
import {
  SPOKEN_FORMS,
  expandSynonyms,
  searchIcd10,
} from "@/server/icd10/search";

/**
 * The neurologist reported «не могу найти нужный диагноз». Tracing it showed
 * two causes, both reproduced here:
 *   1. multi-word queries required EVERY word to match, so «остеохондроз
 *      шейного отдела» returned nothing while «остеохондроз» returned 17;
 *   2. spoken forms («цефалгия», «ВСД», «грыжа диска») do not appear in the
 *      classifier at all, and one of them even had loud wrong literal
 *      matches (abdominal hernias for «грыжа»).
 * These tests pin the wording the clinic actually uses.
 */
const first = (q: string, n = 3) =>
  searchIcd10(q, n).map((r) => r.code);

describe("ICD search — the way the doctor speaks", () => {
  it("finds the rubric when the query names a region the classifier omits", () => {
    // M42.x is «Остеохондроз позвоночника»; the classifier never says
    // «шейного отдела» there, but the doctor always does.
    expect(first("остеохондроз шейного отдела")[0]).toMatch(/^M42/);
  });

  it("resolves spoken abbreviations", () => {
    expect(first("ВСД")).toContain("G90.9");
    expect(first("ДЭП")).toContain("I67.9");
  });

  it("resolves spoken synonyms to the right chapter, not a homonym", () => {
    // «грыжа» literally matches every abdominal hernia (K40/K43) — the disc
    // rubric must still win, because that is what the phrase means.
    for (const code of first("грыжа диска")) {
      expect(code).toMatch(/^M5[01]/);
    }
    expect(first("цефалгия")[0]).toMatch(/^G44/);
    expect(first("защемление нерва")[0]).toMatch(/^G55/);
  });

  it("ignores stop words instead of matching everything", () => {
    // «в» used to match every row in the catalog — the search answered
    // «прострел в пояснице» with cholera.
    expect(first("прострел в пояснице")).toEqual(["M54.4"]);
  });

  it("keeps precise queries precise", () => {
    expect(first("мигрень")).toEqual(["G43.0", "G43.1", "G43.9"]);
    expect(first("головная боль")[0]).toMatch(/^(G44|R51)/);
  });

  it("still returns nothing for a query that means nothing", () => {
    expect(searchIcd10("ффффф", 5)).toEqual([]);
    expect(searchIcd10("", 5)).toEqual([]);
  });

  it("marks whole-query synonyms as direct so they outrank partial hits", () => {
    expect(expandSynonyms("грыжа диска")).toEqual({
      codes: ["M51.1", "M51.2", "M50.2"],
      phrases: [],
      direct: true,
    });
    // Case forms of the same phrase are the same phrase.
    expect(expandSynonyms("грыжи диска").direct).toBe(true);
    expect(expandSynonyms("мигрень")).toEqual({
      codes: [],
      phrases: [],
      direct: false,
    });
  });
});

/**
 * Audit CT-07: the most frequent diagnoses of a neurology clinic found
 * nothing or garbage («ТИА» → тиамин, «боль в шее» → «Большой слюнной
 * железы», «полинейропатия» → empty), so they left the visit without a code.
 */
describe("ICD search: the clinic's everyday neurology (CT-07)", () => {
  const top = (q: string, n = 3) => searchIcd10(q, n).map((r) => r.code);

  it("puts the intended code in the top three", () => {
    expect(top("тиа")).toContain("G45.9");
    expect(top("ТИА")).toContain("G45.9");
    expect(top("полинейропатия")).toContain("G62.9");
    expect(top("боль в шее")).toContain("M54.2");
    expect(top("хроническая ишемия мозга")).toContain("I67.8");
    expect(top("грыжа диска")).toContain("M51.1");
    expect(top("люмбалгия")).toContain("M54.5");
    expect(top("вертиго")).toContain("R42");
    expect(top("головокружение")[0]).toBe("R42");
    expect(top("дисциркуляторная энцефалопатия")).toContain("I67.8");
    expect(top("ДЭП")).toContain("I67.8");
    expect(top("ВСД")).toContain("G90.8");
    expect(top("остеохондроз")[0]).toMatch(/^M42/);
    expect(top("ГБН")).toContain("G44.2");
    expect(top("невроз")).toContain("F48.9");
    expect(top("карпальный")).toContain("G56.0");
    expect(top("неврит лицевого нерва")).toContain("G51.0");
  });

  it("reads ОНМК as stroke of either kind, not only infarction", () => {
    const codes = top("онмк");
    expect(codes).toContain("I64");
    expect(codes.some((c) => c.startsWith("I61"))).toBe(true);
  });

  it("folds the «нейро» spelling doctors use onto the classifier's «невро»", () => {
    expect(top("нейропатия лицевого нерва")).toContain("G51.0");
    expect(top("полиневропатия")).toEqual(top("полинейропатия"));
  });

  it("never answers a neurology query with a tumour", () => {
    for (const q of [
      "тиа",
      "полинейропатия",
      "боль в шее",
      "хроническая ишемия мозга",
      "онмк",
      "грыжа диска",
      "люмбалгия",
      "вертиго",
      "шейный остеохондроз",
    ]) {
      for (const code of top(q, 5)) {
        expect(code, `${q} → ${code}`).not.toMatch(/^C[0-9]/);
      }
    }
  });

  it("matches abbreviations on word boundaries only", () => {
    // «ТИА» is a word, not the start of «тиамин» or «Понтиак».
    for (const code of top("тиа", 12)) expect(code).toMatch(/^G45/);
    // And the reverse: typing «тиамин» must not drag in TIA.
    expect(expandSynonyms("тиамин").codes).toEqual([]);
    for (const code of top("тиамин", 12)) expect(code).not.toMatch(/^G45/);
    // «ХИМ» is chronic brain ischaemia, never a chemical burn.
    for (const code of top("хим", 12)) expect(code).not.toMatch(/^T/);
  });

  it("does not let a short stem reach an unrelated longer root", () => {
    // stemRu(«боль») is «бол», and «больш…» used to count as a match. A
    // lone word may still be half typed, so «Большой…» can follow, but only
    // after every name that says «боль» itself.
    const names = searchIcd10("боль", 30).map((r) => r.nameRu.toLowerCase());
    const lastPain = names.findLastIndex((n) => /^боль[ ,]/.test(n));
    const firstBig = names.findIndex((n) => n.startsWith("больш"));
    expect(lastPain).toBeGreaterThanOrEqual(0);
    if (firstBig >= 0) expect(firstBig).toBeGreaterThan(lastPain);
    // A complete word in the middle of the query is never a prefix.
    expect(top("боль в шее", 12)).not.toContain("C08.9");
  });

  it("only maps spoken forms to codes that exist in the catalog", () => {
    const known = new Set(ICD10_ENTRIES.map((e) => e.code));
    for (const [spoken, form] of Object.entries(SPOKEN_FORMS)) {
      for (const code of form.codes ?? []) {
        expect(known.has(code), `${spoken} → ${code}`).toBe(true);
      }
    }
  });
});

/**
 * Audit CT-08: «с» and «без» were stop words, so «мигрень с аурой» and
 * «мигрень без ауры» were the same query and G43.0 (without aura) won the
 * tie; and a synonym expansion outranked the literal diagnosis, putting S06.7
 * (prolonged coma) above the concussion itself.
 */
describe("ICD search: words that change the meaning (CT-08)", () => {
  it("keeps «с» and «без» apart", () => {
    expect(searchIcd10("мигрень с аурой", 5)[0]?.code).toBe("G43.1");
    expect(searchIcd10("мигрень без ауры", 5)[0]?.code).toBe("G43.0");
    // «без X» never matches a name where X stands without «без», and back.
    expect(searchIcd10("мигрень без ауры", 5).map((r) => r.code)).not.toContain(
      "G43.1",
    );
    expect(searchIcd10("мигрень с аурой", 5).map((r) => r.code)).not.toContain(
      "G43.0",
    );
    expect(
      searchIcd10("депрессивный эпизод с психотическими симптомами", 1)[0]?.code,
    ).toBe("F32.3");
    expect(
      searchIcd10("депрессивный эпизод без психотических симптомов", 1)[0]?.code,
    ).toBe("F32.2");
  });

  it("leans the right way while the doctor is still typing", () => {
    expect(searchIcd10("мигрень без", 5)[0]?.code).toBe("G43.0");
    expect(searchIcd10("мигрень с", 5)[0]?.code).toBe("G43.1");
  });

  it("ranks the literal diagnosis above a synonym expansion", () => {
    expect(searchIcd10("сотрясение мозга", 5)[0]?.code).toBe("S06.0");
    expect(searchIcd10("сотрясение мозга", 5).map((r) => r.code)).not.toContain(
      "S06.7",
    );
    // A literal full match on every word stays on top even when a spoken
    // form of the same query exists.
    expect(searchIcd10("головная боль напряжения", 1)[0]?.code).toBe("G44.2");
    expect(searchIcd10("транзиторная ишемическая атака", 1)[0]?.code).toBe(
      "G45.9",
    );
  });
});

/**
 * Review of the CT-07/CT-08 rescoring. A partial match scored every word the
 * same, so two region words («шейного», «отдела») outscored the one diagnosis
 * word and «дорсопатия шейного отдела» opened with C15.0, oesophageal cancer.
 * The tumour sites of chapter II are named by anatomy alone, so the same
 * thing happened to «ишемия спинного мозга» (C72.0) and friends.
 */
describe("ICD search: region words qualify a diagnosis, they never make one", () => {
  const top = (q: string, n = 5) => searchIcd10(q, n).map((r) => r.code);
  const noTumour = (q: string) => {
    for (const code of top(q)) {
      expect(code, `${q} → ${code}`).not.toMatch(/^(C\d|D[0-4]\d)/);
    }
  };

  it("puts the diagnosis first, not the oesophagus that shares the region", () => {
    expect(top("дорсопатия шейного отдела")[0]).toBe("M53.9");
    expect(top("дорсалгия шейного отдела")[0]).toBe("M54.9");
    expect(top("спондилез шейного отдела")[0]).toBe("M47.9");
    for (const q of [
      "дорсопатия шейного отдела",
      "дорсалгия шейного отдела",
      "спондилез шейного отдела",
      "остеохондроз шейного отдела позвоночника",
      "миофасциальный синдром шейного отдела",
    ]) {
      expect(top(q)[0], q).toMatch(/^M/);
      noTumour(q);
    }
  });

  it("does not lead with a sprain for the lumbar region", () => {
    expect(top("дорсопатия поясничного отдела")[0]).toBe("M53.9");
    for (const code of top("дорсопатия поясничного отдела")) {
      expect(code).not.toMatch(/^S/);
    }
  });

  it("keeps limbs and sides out of the match for a nerve diagnosis", () => {
    // «нижних конечностей» used to bring in limb melanomas and leg thromboses.
    const codes = top("полинейропатия нижних конечностей");
    for (const code of codes) expect(code).toMatch(/^G6[23]/);
    expect(top("невропатия лицевого нерва справа")[0]).toMatch(/^G51/);
  });

  it("never reaches a tumour site through anatomy alone", () => {
    for (const q of [
      "ишемия спинного мозга",
      "невропатия слухового нерва",
      "киста головного мозга",
      "полинейропатия нижних конечностей",
    ]) {
      noTumour(q);
    }
    expect(top("невропатия слухового нерва")[0]).toBe("H93.3");
  });

  it("still finds the tumour when the doctor names one", () => {
    expect(top("опухоль спинного мозга")).toContain("C72.0");
    expect(top("аденома гипофиза")).toContain("D35.2");
    expect(top("рак пищевода")).toContain("C15.9");
    // A full literal match on the site is still a match, listed after the
    // rows that are not tumours (CT-06 review).
    expect(top("спинного мозга", 30)).toContain("C72.0");
  });

  it("keeps the siblings of the named category over a homonym", () => {
    // «грыжа» alone finds groin hernias; the spoken form names M50.2, so
    // the rest of M50 follows it instead.
    for (const code of top("грыжа шейного отдела позвоночника")) {
      expect(code).toMatch(/^M50/);
    }
    expect(top("протрузия шейного отдела")[0]).toBe("M50.2");
  });
});

/**
 * Review: spoken forms matched only when their words stood back to back, so
 * «последствия перенесенного ОНМК» missed «последствия онмк», matched the
 * bare «ОНМК», and a follow-up visit was offered acute stroke codes first.
 */
describe("ICD search: sequelae worded with a word in between", () => {
  const top = (q: string, n = 5) => searchIcd10(q, n).map((r) => r.code);

  it("reads «последствия перенесенного ОНМК» as stroke sequelae", () => {
    const codes = top("последствия перенесенного онмк");
    expect(codes[0]).toMatch(/^I69/);
    expect(codes[1]).toMatch(/^I69/);
    for (const code of codes) expect(code).not.toMatch(/^I6[0-4]/);
    expect(top("последствия перенесенного ОНМК")).toEqual(codes);
  });

  it("reads «последствия перенесенной ЧМТ» as head injury sequelae", () => {
    const codes = top("последствия перенесенной чмт");
    expect(codes[0]).toBe("T90.5");
    for (const code of codes) expect(code).not.toMatch(/^S06/);
  });

  it("lets the longer form win over the abbreviation inside it", () => {
    expect(expandSynonyms("последствия перенесенного онмк").codes).toEqual([
      "I69.4",
      "I69.3",
    ]);
    expect(expandSynonyms("последствия онмк").codes).toEqual(["I69.4", "I69.3"]);
    expect(expandSynonyms("последствия перенесенной ЧМТ").codes).toEqual(["T90.5"]);
    expect(top("последствия онмк")).not.toContain("I64");
  });

  it("names the stroke type when the doctor does", () => {
    expect(top("последствия ишемического инсульта")[0]).toBe("I69.3");
    expect(top("последствия перенесенного ишемического инсульта")[0]).toBe("I69.3");
    expect(top("последствия геморрагического инсульта")[0]).toBe("I69.1");
    for (const code of top("последствия ишемического инсульта")) {
      expect(code).not.toBe("I63.9");
    }
  });

  it("finds a form with a side or a detail inside it", () => {
    expect(top("неврит левого лицевого нерва")[0]).toMatch(/^G51/);
    expect(top("хроническая ишемия головного мозга")[0]).toBe("I67.8");
  });

  it("keeps a form's words within one phrase", () => {
    // Three words apart is another thought, not the same diagnosis.
    expect(
      expandSynonyms("последствия травмы ноги давней онмк").codes,
    ).toEqual(["I64", "I63.9", "I61.9"]);
    // The key's order matters: «онмк» then «последствия» is not the form.
    expect(expandSynonyms("онмк последствия").codes).toEqual([
      "I64",
      "I63.9",
      "I61.9",
    ]);
  });
});

/**
 * Review of CT-02: once the catalog listed E10..E14 leaf by leaf, «сахарный
 * диабет» matched fifty rows word for word, the ten E12 leaves (diabetes of
 * malnutrition) tied at the top and no E11 made the typeahead at all. Type 2
 * diabetes is the usual comorbidity next to a polyneuropathy on the new
 * multi-diagnosis card; the first suggestion was the wrong kind.
 */
describe("ICD search: diabetes as a comorbidity", () => {
  const top = (q: string, n = 10) => searchIcd10(q, n).map((r) => r.code);
  const perCategory = (codes: string[]) => {
    const n = new Map<string, number>();
    for (const c of codes) n.set(c.split(".")[0]!, (n.get(c.split(".")[0]!) ?? 0) + 1);
    return Math.max(...n.values());
  };

  it("offers type 2 first for the untyped phrase, and no category floods", () => {
    const codes = top("сахарный диабет", 25);
    expect(codes.slice(0, 5)).toEqual(["E11.9", "E11.4", "E10.9", "E10.4", "E14.9"]);
    expect(perCategory(codes.slice(0, 10))).toBeLessThanOrEqual(3);
    expect(top("СД", 5)).toEqual(codes.slice(0, 5));
  });

  it("reads the type the doctor names, in the usual spellings", () => {
    for (const q of [
      "сахарный диабет 2 типа",
      "Сахарный диабет 2-го типа",
      "сахарный диабет тип 2",
      "диабет 2 типа",
      "СД 2 типа",
      "сд 2",
      "СД2",
    ]) {
      const codes = top(q);
      expect(codes.slice(0, 2), q).toEqual(["E11.9", "E11.4"]);
      // The rest of E11 follows; a pregnancy code of the same type may close it.
      for (const code of codes) expect(code, `${q} → ${code}`).toMatch(/^(E11|O24\.1)/);
    }
    for (const q of ["сахарный диабет 1 типа", "СД 1 типа", "сд1"]) {
      const codes = top(q);
      expect(codes.slice(0, 2), q).toEqual(["E10.9", "E10.4"]);
      for (const code of codes) expect(code, `${q} → ${code}`).toMatch(/^(E10|O24\.0)/);
    }
    // The number is the diagnosis: 1 and 2 are not the same form.
    expect(expandSynonyms("сахарный диабет 1 типа").codes).not.toContain("E11.9");
  });

  it("reads the insulin wording, with or without the linking «о»", () => {
    expect(top("инсулиннезависимый", 2)).toEqual(["E11.9", "E11.4"]);
    expect(top("инсулинонезависимый сахарный диабет", 2)).toEqual(["E11.9", "E11.4"]);
    expect(top("инсулинозависимый", 2)).toEqual(["E10.9", "E10.4"]);
  });

  it("reaches every kind of diabetes while the word is still being typed", () => {
    // No spoken form matches half a word: the sibling cap alone keeps E12
    // from filling the list.
    const codes = top("сахарный диаб", 25);
    expect(codes.some((c) => c.startsWith("E11"))).toBe(true);
    expect(codes.some((c) => c.startsWith("E10"))).toBe(true);
    expect(perCategory(codes.slice(0, 12))).toBeLessThanOrEqual(3);
  });

  it("reaches E10 and E11 through an equal match that only lost the first-word bonus", () => {
    // E11 «Инсулиннезависимый сахарный диабет …» matched the same words as
    // E12 «Сахарный диабет, связанный …», so it may pass E12's fourth leaf.
    const codes = top("сахарный диабет", 25);
    expect(codes.indexOf("E11.0")).toBeGreaterThan(-1);
    expect(codes.indexOf("E11.0")).toBeLessThan(codes.indexOf("E12.3"));
    // A weaker match («сахарного диабета», «несахарный») never does.
    for (const code of ["E13.0", "E23.2", "N25.1"]) {
      const at = codes.indexOf(code);
      if (at >= 0) expect(at, code).toBeGreaterThan(codes.indexOf("E12.3"));
    }
  });

  it("leaves a typed code and an unrelated word alone", () => {
    // The doctor asked for the category: all of it, in code order.
    expect(top("E11", 10)).toEqual([
      "E11.0", "E11.1", "E11.2", "E11.3", "E11.4",
      "E11.5", "E11.6", "E11.7", "E11.8", "E11.9",
    ]);
    // «СД» is a whole word: «сдавление» is still compression.
    for (const code of top("сдавление")) expect(code).not.toMatch(/^E1[0-4]/);
  });
});

/**
 * Pre-deploy review of the sibling cap: holding a category's fourth rubric
 * until every other category had shown one pushed the doctor's rubric below
 * poisonings, newborn and injury codes on plain queries nobody curated. A
 * category's own rubrics now keep their place unless a second category
 * floods the same equally good matches.
 */
describe("ICD search: a category's rubrics are not held behind weaker rows", () => {
  const top = (q: string) => searchIcd10(q, 25).map((r) => r.code);
  /** Every `before` code is listed, and ahead of every `after` code listed. */
  const ahead = (q: string, before: string[], after: string[]) => {
    const codes = top(q);
    for (const b of before) {
      const at = codes.indexOf(b);
      expect(at, `${q}: ${b} listed`).toBeGreaterThan(-1);
      for (const a of after) {
        const other = codes.indexOf(a);
        if (other >= 0) expect(at, `${q}: ${b} before ${a}`).toBeLessThan(other);
      }
    }
  };

  it("эпилепсия: all of G40 before family history and aphasia", () => {
    ahead("эпилепсия", ["G40.0", "G40.1", "G40.2", "G40.3"], ["Z82.0", "F80.3"]);
  });

  it("паркинсон: secondary parkinsonism before the drug poisonings", () => {
    ahead("паркинсон", ["G20", "G21.8", "G21.9"], ["T42.8", "X41", "X61", "Y11", "Y46.7"]);
  });

  it("шейный: the cervical disc rubrics before the neck injuries", () => {
    ahead(
      "шейный",
      ["M50.3", "M50.8", "M50.9"],
      ["S11.2", "S12.0", "S12.1", "S13.1", "S13.4", "S14.0", "S14.1", "S14.2"],
    );
  });

  it("субарахноидальное кровоизлияние: all of I60 before newborn and trauma", () => {
    ahead(
      "субарахноидальное кровоизлияние",
      ["I60.3", "I60.4", "I60.5", "I60.6", "I60.7", "I60.9"],
      ["P10.3", "P52.5", "S06.6", "I69.0"],
    );
  });

  it("инфаркт мозга: the acute infarct before its sequelae", () => {
    ahead(
      "инфаркт мозга",
      ["I63.3", "I63.4", "I63.5", "I63.6", "I63.9"],
      ["I69.3", "I69.4"],
    );
  });

  it("депрессивный эпизод and головная боль keep the rubric that says it", () => {
    ahead("депрессивный эпизод", ["F32.3", "F32.9"], ["F33.0", "F33.1", "F33.2"]);
    ahead("головная боль", ["G44.3", "G44.0", "G44.8"], ["O29.4", "O74.5", "O89.4"]);
  });

  it("still spreads two categories that flood equally good matches", () => {
    // «кровоизлияние» ties I60 and I61 word for word: both show.
    const codes = top("кровоизлияние");
    expect(codes).toContain("I61.0");
    expect(codes.filter((c) => c.startsWith("I60")).length).toBeLessThanOrEqual(3);
  });
});
