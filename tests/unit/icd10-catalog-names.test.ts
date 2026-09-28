import { describe, expect, it } from "vitest";

import { buildDiagnosisShortlist } from "@/server/catalog/shortlist";
import { ICD10_ENTRIES } from "@/server/icd10/data";
import { searchIcd10 } from "@/server/icd10/search";

/**
 * Audit CT-06: ICD leaves copied without their category. The classifier
 * prints a subcategory as the rest of its category's sentence, so D33.0
 * (benign) and D43.0 (uncertain behaviour) both read «Головного мозга над
 * мозговым наметом», and a signed conclusion carried that phrase with no
 * word «новообразование». 216 names were shared by two or more codes.
 */

const byCode = new Map(ICD10_ENTRIES.map((e) => [e.code, e.nameRu]));
const name = (code: string) => byCode.get(code);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

describe("ICD catalog names (CT-06)", () => {
  it("never gives two codes the same name", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const e of ICD10_ENTRIES) {
      const key = norm(e.nameRu);
      const other = seen.get(key);
      if (other) clashes.push(`${other} / ${e.code}: ${e.nameRu}`);
      seen.set(key, e.code);
    }
    expect(clashes).toEqual([]);
  });

  it("tells a benign brain tumour from one of uncertain behaviour", () => {
    expect(name("D33.0")).toBe(
      "Доброкачественное новообразование головного мозга над мозговым наметом",
    );
    expect(name("D43.0")).toBe(
      "Новообразование неопределенного или неизвестного характера головного мозга над мозговым наметом",
    );
    for (const code of ["D33.0", "D43.0", "D32.0", "C71.6"]) {
      expect(name(code)).toMatch(/новообразование/i);
    }
    expect(name("C71.6")).toBe("Злокачественное новообразование мозжечка");
  });

  it("names the poisoning and the toxic agent, not only the agent", () => {
    expect(name("T42.1")).toBe("Отравление иминостильбенами");
    expect(name("T51.0")).toBe("Токсическое действие этанола");
    expect(name("Y06.1")).toBe("Лишение ухода или оставление без присмотра родителем");
  });

  it("puts the category before a qualifier that means nothing alone", () => {
    expect(name("K25.0")).toBe("Язва желудка: острая с кровотечением");
    expect(name("K26.0")).toBe("Язва двенадцатиперстной кишки: острая с кровотечением");
    expect(name("F10.2")).toBe(
      "Психические и поведенческие расстройства, вызванные употреблением алкоголя: синдром зависимости",
    );
  });

  it("finishes names the printed book cut at a line break", () => {
    expect(name("C71.8")).toBe(
      "Злокачественное новообразование головного мозга: поражение, выходящее за пределы одной и более вышеуказанных локализаций головного мозга",
    );
    expect(name("F31.4")).toBe(
      "Биполярное аффективное расстройство, текущий эпизод тяжелой депрессии без психотических симптомов",
    );
    expect(name("S53.4")).toBe(
      "Растяжение и перенапряжение капсульно-связочного аппарата локтевого сустава",
    );
    for (const e of ICD10_ENTRIES) {
      expect(e.nameRu, e.code).not.toMatch(/\p{L}-$/u);
      expect(e.nameRu, e.code).not.toMatch(/[—–]/);
    }
    expect(name("F19.0")).toMatch(/одновременным употреблением/);
  });

  it("keeps only real codes", () => {
    for (const e of ICD10_ENTRIES) {
      expect(e.code).toMatch(/^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?[+*]?$/);
    }
  });

  it("leaves the codes the neurologist writes every day as they were", () => {
    expect(name("G43.0")).toBe("Мигрень без ауры [простая мигрень]");
    expect(name("G44.2")).toBe("Головная боль напряженного типа");
    expect(name("M42.1")).toBe("Остеохондроз позвоночника у взрослых");
    expect(name("M54.5")).toBe("Боль внизу спины");
    expect(name("I67.8")).toBe("Другие уточненные поражения сосудов мозга");
  });
});

describe("ICD search for a brain tumour (CT-06)", () => {
  const top5 = (q: string) => searchIcd10(q, 5).map((r) => r.code);
  const brainTumour = /^(C71|D32|D33|D43)/;

  it("finds brain tumour rubrics for «опухоль головного мозга»", () => {
    const codes = top5("опухоль головного мозга");
    expect(codes.some((c) => brainTumour.test(c))).toBe(true);
    // Every one of the five is a tumour, not an abscess of the brain.
    for (const c of codes) expect(c).toMatch(/^(C|D[0-4])/);
  });

  it("finds the meninges rubric for «менингиома», not meningitis", () => {
    const codes = top5("менингиома");
    expect(codes[0]).toBe("D32.0");
    for (const c of codes) expect(c).toMatch(/^(D32|D42)/);
  });
});

/**
 * Review of CT-06: once the «.8» tumour rows were finished, their names carry
 * the site AND the generic «поражение» («Злокачественное новообразование
 * головного мозга: поражение, выходящее за пределы…»). A query that never
 * called anything a tumour then matched them in full and opened with them:
 * «поражение головного мозга» → C71.8, «поражение черепных нервов» → C72.8,
 * and «головная боль» (the clinic's most common query) had C71.8 at #6
 * through «боль» ≈ «более».
 */
describe("ICD search for a query that names no tumour (CT-06 review)", () => {
  const codes = (q: string, n = 10) => searchIcd10(q, n).map((r) => r.code);
  const TUMOUR = /^(C\d|D[0-4]\d)/;

  it("opens with the neurology rubric, not a malignant one", () => {
    expect(codes("поражение головного мозга")[0]).toBe("G93.9");
    expect(codes("поражение черепных нервов")[0]).not.toMatch(TUMOUR);
    expect(codes("лицевой нерв")[0]).toMatch(/^G51/);
    expect(codes("зрительного нерва")[0]).toBe("H46");
  });

  it("keeps every tumour code out of the first page for «головная боль»", () => {
    for (const c of codes("головная боль")) expect(c).not.toMatch(TUMOUR);
    // «более» is not a form of «боль».
    expect(codes("головная боль", 100)).not.toContain("C71.8");
  });

  it("lists a site's tumour rubrics after every other row, not instead of them", () => {
    for (const q of [
      "поражение головного мозга",
      "поражение черепных нервов",
      "спинного мозга",
      "черепных нервов",
      "головного мозга",
    ]) {
      const all = codes(q, 200);
      const firstTumour = all.findIndex((c) => TUMOUR.test(c));
      if (firstTumour < 0) continue;
      expect(all.slice(firstTumour).every((c) => TUMOUR.test(c)), q).toBe(true);
    }
    // Still there for the doctor who scrolls: a full match is a match.
    expect(codes("спинного мозга", 30)).toContain("C72.0");
  });

  it("does not let a tumour row crowd out the partial matches of the organ", () => {
    // Its only full match was C72.8, and it used to be the only answer.
    const first = codes("поражение спинного мозга", 12);
    for (const c of first) expect(c).not.toMatch(TUMOUR);
    expect(first).toContain("G95.9");
  });

  it("changes nothing for a query that names the tumour", () => {
    expect(codes("опухоль головного мозга", 5).every((c) => TUMOUR.test(c))).toBe(true);
    expect(codes("опухоль спинного мозга", 5)).toContain("C72.0");
    expect(codes("рак пищевода", 1)).toEqual(["C15.9"]);
    // An explicit code is never held back.
    expect(codes("C71.8", 1)).toEqual(["C71.8"]);
  });
});

describe("diagnosis shortlist and the old fragments (CT-06)", () => {
  const nameForCode = (code: string) => name(code) ?? null;
  const d = (iso: string) => new Date(iso);

  it("offers the full name instead of a fragment stored before the fix", () => {
    const rows = buildDiagnosisShortlist({
      pinnedCodes: [],
      uses: [
        { code: "D33.0", name: "Головного мозга над мозговым наметом", at: d("2026-09-20") },
        { code: "K25.0", name: "Острая с кровотечением", at: d("2026-09-19") },
      ],
      nameForCode,
      limit: 10,
    });
    expect(rows.map((r) => r.name)).toEqual([
      "Доброкачественное новообразование головного мозга над мозговым наметом",
      "Язва желудка: острая с кровотечением",
    ]);
  });

  it("keeps the doctor's own wording for a code", () => {
    const rows = buildDiagnosisShortlist({
      pinnedCodes: [],
      uses: [{ code: "G43.0", name: "Мигрень без ауры, частые приступы", at: d("2026-09-20") }],
      nameForCode,
      limit: 10,
    });
    expect(rows[0]!.name).toBe("Мигрень без ауры, частые приступы");
  });
});
