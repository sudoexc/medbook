/**
 * The visit screen's mouse-first prescriptions (clinic request 03.10.2026).
 *
 * The doctor works with the mouse: «Назначения» moved to the top of the
 * middle column (the unused conclusion editor left the screen), the picker
 * became three columns always on screen («Частые», «Мои», «Каталог»), each
 * drug one click from the visit with his usual dose and schema, and the
 * catalog window that was cut off on the right fits the screen again.
 *
 * These tests drive the column data sources (the server's builder and the
 * client helpers), the one-click doses, the template text without an
 * editor, and pin the layout decisions in the source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildDrugColumns, buildDrugShortlist } from "@/server/catalog/shortlist";
import {
  atcSubgroups,
  catalogRootGroups,
  onVisitChecker,
  starredColumn,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";
import {
  draftFromCatalogPick,
  draftFromShortItem,
  shortItemFromDrug,
  shortItemKind,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import type { DrugSearchHit } from "@/app/[locale]/doctor/reception/_hooks/use-drug-search";
import type {
  DrugShortItem,
  DrugUsual,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";
import {
  ATC_GROUPS,
  ATC_SUBGROUPS,
  atcSubgroupLabel,
} from "@/lib/catalogs/atc-groups";
import {
  formatPrescriptionLine,
  formatPrescriptionSchedule,
} from "@/lib/catalogs/prescription-format";
import { quickDoseOptions } from "@/lib/catalogs/quick-doses";
import { appendSnippet, removeSnippet } from "@/lib/conclusion-body";
import { emptyConclusionSections, draftHasContent } from "@/lib/visit-note-sections";

const d = (iso: string) => new Date(iso);

function hit(id: string, over: Partial<DrugSearchHit> = {}): DrugSearchHit {
  return {
    id,
    inn: id,
    nameRu: id,
    nameUz: null,
    atcCode: null,
    category: "OTHER",
    forms: [{ form: "TAB", strengths: ["50 мг", "150 мг"] }],
    defaultDosing: null,
    rxOnly: true,
    brands: [],
    ...over,
  };
}

// ── The server's columns ─────────────────────────────────────────────

describe("buildDrugColumns: «Частые», «Мои» and his usual dose", () => {
  const structured = [
    {
      drugId: "tolperisone",
      displayName: "Мидокалм (толперизон)",
      dose: "150 мг",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 10,
      at: d("2026-09-20"),
    },
    {
      drugId: "tolperisone",
      displayName: "Толперизон",
      dose: "50 мг",
      timesOfDay: ["NIGHT"],
      mealRelation: "NO_MATTER",
      durationDays: 5,
      at: d("2026-09-01"),
    },
    { drugId: "nimesulide", displayName: "Найз", dose: "100 мг", at: d("2026-09-10") },
    { drugId: "nimesulide", displayName: "Найз", dose: null, at: d("2026-09-11") },
    { drugId: "nimesulide", displayName: "Найз", dose: null, at: d("2026-09-12") },
    { drugId: "sumatriptan", displayName: "Сумамигрен", dose: "50 мг", at: d("2026-09-15") },
  ];

  it("«Частые» is his history by count; a star does not push it out", () => {
    const cols = buildDrugColumns({
      pinnedIds: ["sumatriptan", "citicoline"],
      structured,
      freeText: [],
      frequentLimit: 10,
      usualLimit: 100,
    });
    expect(cols.frequent.map((i) => [i.drugId, i.count, i.pinned])).toEqual([
      ["nimesulide", 3, false],
      ["tolperisone", 2, false],
      // Starred AND frequent: in both columns, flagged.
      ["sumatriptan", 1, true],
    ]);
    // The shortlist, by contrast, lifts stars to the top.
    const short = buildDrugShortlist({
      pinnedIds: ["sumatriptan"],
      structured,
      freeText: [],
      limit: 10,
    });
    expect(short[0].drugId).toBe("sumatriptan");
  });

  it("«Мои» keeps his order; a star he never wrote waits for its catalog label", () => {
    const cols = buildDrugColumns({
      pinnedIds: ["citicoline", "tolperisone", "citicoline"],
      structured,
      freeText: [],
      frequentLimit: 10,
      usualLimit: 100,
    });
    expect(cols.starred.map((i) => [i.key, i.count, i.label])).toEqual([
      ["citicoline", 0, ""],
      ["tolperisone", 2, "Мидокалм (толперизон)"],
    ]);
    expect(cols.starred.every((i) => i.pinned)).toBe(true);
  });

  it("the schema travels with the dose it was written with", () => {
    const { usual } = buildDrugColumns({
      pinnedIds: [],
      structured,
      freeText: [],
      frequentLimit: 10,
      usualLimit: 100,
    });
    expect(usual.get("tolperisone")).toMatchObject({
      lastDose: "150 мг",
      lastTimesOfDay: ["MORNING", "EVENING"],
      lastMealRelation: "AFTER_MEAL",
      lastDurationDays: 10,
    });
    // The newest visits wrote no dose: the dose and its schema come from
    // the visit that did, never a dose of one visit with times of another.
    expect(usual.get("nimesulide")).toMatchObject({
      lastDose: "100 мг",
      lastTimesOfDay: [],
      lastMealRelation: null,
      lastDurationDays: null,
    });
  });

  it("limits: the column and the usual map are bounded, free text has no usual", () => {
    const cols = buildDrugColumns({
      pinnedIds: [],
      structured,
      freeText: [{ line: "Магне B6 — по 2 таб", at: d("2026-09-30") }],
      frequentLimit: 2,
      usualLimit: 1,
    });
    expect(cols.frequent).toHaveLength(2);
    expect([...cols.usual.keys()]).toEqual(["nimesulide"]);
    const all = buildDrugColumns({
      pinnedIds: [],
      structured: [],
      freeText: [{ line: "Магне B6 — по 2 таб", at: d("2026-09-30") }],
      frequentLimit: 5,
      usualLimit: 5,
    });
    expect(all.frequent[0]).toMatchObject({ drugId: null, count: 1 });
    expect(all.usual.size).toBe(0);
  });
});

// ── One click, his usual dose and schema ─────────────────────────────

describe("a pick brings back his dose and schema", () => {
  const usual: DrugUsual = {
    label: "Мидокалм (толперизон)",
    count: 4,
    lastDose: "150 мг",
    lastForm: "TAB",
    lastStrength: "150 мг",
    lastTimesOfDay: ["EVENING", "MORNING"],
    lastMealRelation: "AFTER_MEAL",
    lastDurationDays: 10,
  };

  it("a «Частые» item: dose, times in order, meal and days", () => {
    const item = shortItemFromDrug(hit("tolperisone"), usual);
    const { draft } = draftFromShortItem(item, shortItemKind(item));
    expect(draft).toMatchObject({
      displayName: "Мидокалм (толперизон)",
      dose: "150 мг",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 10,
    });
  });

  it("values a later build does not know never reach the save", () => {
    const item = shortItemFromDrug(hit("tolperisone"), {
      ...usual,
      lastTimesOfDay: ["MORNING", "LUNCH"],
      lastMealRelation: "WHENEVER",
      lastDurationDays: 9999,
    });
    const { draft } = draftFromShortItem(item, "mine");
    expect(draft).toMatchObject({
      timesOfDay: ["MORNING"],
      mealRelation: "NO_MATTER",
      durationDays: null,
    });
  });

  it("a catalog drug he has written comes back his way; a new one as the catalog has it", () => {
    const mine = draftFromCatalogPick(hit("tolperisone"), usual);
    expect(mine.draft).toMatchObject({ dose: "150 мг", durationDays: 10 });
    const fresh = draftFromCatalogPick(hit("tolperisone"), undefined);
    expect(fresh.draft).toMatchObject({
      displayName: "tolperisone",
      dose: "50 мг",
      timesOfDay: [],
      durationDays: null,
    });
  });

  it("a brand search keeps the brand he typed, with his dose", () => {
    const drug = hit("tolperisone", {
      nameRu: "Толперизон",
      brands: [{ id: "b1", name: "Мидокалм", manufacturer: null }],
    });
    const { draft } = draftFromCatalogPick(drug, { ...usual, label: "Толперизон" }, "мидокалм");
    expect(draft.displayName).toBe("Мидокалм (толперизон)");
    expect(draft.dose).toBe("150 мг");
  });

  it("a never written core drug takes the clinic's wording", () => {
    const item = shortItemFromDrug(hit("propranolol", { nameRu: "Пропранолол", brands: [{ id: "b", name: "Анаприлин", manufacturer: null }] }), undefined, {
      label: "Анаприлин",
    });
    expect(shortItemKind(item)).toBe("clinic");
    expect(draftFromShortItem(item, "clinic").draft.displayName).toBe(
      "Анаприлин (пропранолол)",
    );
  });

  it("the usual line is the schedule part of the printed line", () => {
    const row = {
      displayName: "Найз",
      dose: "100 мг",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 5,
    };
    const schedule = formatPrescriptionSchedule(row, "ru");
    expect(schedule).toBe("100 мг, утром и вечером, после еды, 5 дн.");
    expect(formatPrescriptionLine(row, "ru")).toBe(`Найз — ${schedule}`);
    expect(formatPrescriptionSchedule({ ...row, dose: "", timesOfDay: [], mealRelation: "NO_MATTER", durationDays: null }, "uz")).toBe("");
  });
});

// ── The client columns ───────────────────────────────────────────────

describe("the columns on screen", () => {
  it("an item already on the visit is found by id or by its folded name", () => {
    const onVisit = onVisitChecker(
      [{ drugId: "tolperisone", displayName: "Мидокалм (толперизон)" }],
      ["Магне® B6 — по 2 таб", "———"],
    );
    expect(onVisit({ drugId: "tolperisone", label: "Толперизон" })).toBe(true);
    // Cyrillic В, no ®: the same drug he wrote as a text line.
    expect(onVisit({ drugId: null, label: "Магне В6 — по 2 таб" })).toBe(true);
    // The line names the drug «Магне В6»: one drug, so it is on the visit
    // (review of 03.10.2026: a row and a line of one drug went on the
    // sheet twice). A longer name is another drug.
    expect(onVisit({ drugId: null, label: "Магне В6" })).toBe(true);
    expect(onVisit({ drugId: null, label: "Магне В6 форте" })).toBe(false);
    expect(onVisit({ drugId: "nimesulide", label: "Найз" })).toBe(false);
    // A line of dashes names nothing and hides nothing.
    expect(onVisit({ drugId: null, label: "—" })).toBe(false);
  });

  it("«Мои» follows the stars as they are clicked", () => {
    const server: DrugShortItem[] = [
      { ...shortItemFromDrug(hit("a"), undefined, { pinned: true }), label: "A" },
      { ...shortItemFromDrug(hit("b"), undefined, { pinned: true }), label: "B" },
    ];
    const known = [shortItemFromDrug(hit("c"), { label: "C his", count: 3, lastDose: "1 таб." })];
    const seen = new Map([["d", hit("d", { nameRu: "D" })]]);
    const usual = { d: { label: "D his", count: 2, lastDose: "2 мл" } as DrugUsual };

    // Still loading the stars: the server's list stands in.
    expect(
      starredColumn({ favorites: null, starred: server, known, seen, usual }).map((i) => i.label),
    ).toEqual(["A", "B"]);
    // B unstarred, C starred from «Частые», D from the catalog, E unknown.
    const col = starredColumn({
      favorites: ["a", "c", "d", "e"],
      starred: server,
      known,
      seen,
      usual,
    });
    expect(col.map((i) => i.label)).toEqual(["A", "C his", "D his"]);
    expect(col.every((i) => i.pinned)).toBe(true);
    expect(col[2]).toMatchObject({ drugId: "d", lastDose: "2 мл", count: 2 });
  });

  it("the catalog root: this diagnosis, the clinic's list, then non-empty ATC groups", () => {
    expect(
      catalogRootGroups({
        diagnosisCode: "g43.0",
        diagnosisCount: 4,
        coreCount: 12,
        byGroup: { N: 400, C: 200, Q: 3 },
      }),
    ).toEqual([
      { kind: "diagnosis", code: "G43.0", count: 4 },
      { kind: "core", count: 12 },
      { kind: "atc", code: "C", count: 200 },
      { kind: "atc", code: "N", count: 400 },
    ]);
    const plain = catalogRootGroups({
      diagnosisCode: "G43.0",
      diagnosisCount: 0,
      coreCount: 0,
      byGroup: undefined,
    });
    // Nothing indicated, no core list, no counts: every ATC group, uncounted.
    expect(plain.map((g) => g.kind)).toEqual(ATC_GROUPS.map(() => "atc"));
    expect(plain.every((g) => g.kind === "atc" && g.count === null)).toBe(true);
  });

  it("subgroups: those holding drugs, in code order, unknown prefixes included", () => {
    expect(atcSubgroups("n", { N06: 5, N03: 12, N99: 1, C07: 4, N05: 0 })).toEqual([
      { code: "N03", count: 12 },
      { code: "N06", count: 5 },
      { code: "N99", count: 1 },
    ]);
    expect(atcSubgroupLabel("N99", "ru")).toBeNull();
    const fallback = atcSubgroups("N", undefined);
    expect(fallback.map((s) => s.code)).toEqual(["N01", "N02", "N03", "N04", "N05", "N06", "N07"]);
    expect(atcSubgroups("", {})).toEqual([]);
  });
});

describe("the ATC subgroup glosses", () => {
  it("one per code, under a real main group, in both languages, short and dash free", () => {
    const codes = ATC_SUBGROUPS.map((g) => g.code);
    expect(new Set(codes).size).toBe(codes.length);
    const letters = new Set(ATC_GROUPS.map((g) => g.code));
    for (const g of ATC_SUBGROUPS) {
      expect(g.code, g.code).toMatch(/^[A-Z]\d\d$/);
      expect(letters.has(g.code[0]), g.code).toBe(true);
      for (const text of [g.ru, g.uz]) {
        expect(text.trim().length, g.code).toBeGreaterThan(2);
        expect(text, g.code).not.toMatch(/[—–]/);
        expect(text.length, g.code).toBeLessThanOrEqual(48);
      }
    }
    expect(atcSubgroupLabel("n03ab02", "uz")).toBe("Epilepsiyaga qarshi");
    expect(atcSubgroupLabel("N03", "ru")).toBe("Противоэпилептические");
  });
});

// ── One-click doses ──────────────────────────────────────────────────

describe("quickDoseOptions: the dose prompt answered with a click", () => {
  it("an ampoule's volume first, then the usual amounts of the form", () => {
    expect(quickDoseOptions("INJ_IM", ["2 мл", "500 мг/4 мл"], "ru")).toEqual([
      "2 мл",
      "1 амп.",
      "1 мл",
      "5 мл",
    ]);
  });

  it("never a concentration, a pack or a bottle", () => {
    const opts = quickDoseOptions("SYRUP", ["100 мг/5 мл", "1 флакон", "100 мл", "5 мл"], "ru");
    expect(opts).toEqual(["5 мл", "2,5 мл", "10 мл", "15 мл"]);
  });

  it("tablets: the unit strengths, then counts; in the interface language", () => {
    expect(quickDoseOptions("TAB", ["50 мг", "150мг"], "ru")).toEqual([
      "50 мг",
      "150 мг",
      "1 таб.",
      "2 таб.",
      "½ таб.",
    ]);
    expect(quickDoseOptions("DROPS_EYE", [], "uz")).toEqual(["1 tomchi", "2 tomchi"]);
    expect(quickDoseOptions(null, [], "ru").length).toBeGreaterThan(0);
    expect(quickDoseOptions("CREAM", ["5%"], "ru")).toEqual(["тонким слоем"]);
  });

  it("at most six chips", () => {
    expect(
      quickDoseOptions("TAB", ["5 мг", "10 мг", "20 мг", "40 мг", "80 мг"], "ru"),
    ).toHaveLength(6);
  });
});

// ── Template text without an editor ──────────────────────────────────

describe("protocol and preset templates reach the conclusion without the editor", () => {
  it("append as a paragraph, remove the same paragraph", () => {
    const body = appendSnippet("Осмотр.", "Шаблон протокола");
    expect(body).toBe("Осмотр.\n\nШаблон протокола");
    expect(appendSnippet("", "  Шаблон  ")).toBe("Шаблон");
    expect(appendSnippet("Осмотр.", "   ")).toBe("Осмотр.");
    expect(removeSnippet(body, "Шаблон протокола")).toBe("Осмотр.");
    expect(removeSnippet("Шаблон\n\nОсмотр.", "Шаблон")).toBe("Осмотр.");
    expect(removeSnippet("Осмотр.", "Нет такого")).toBe("Осмотр.");
  });
});

describe("the empty-sections check without a conclusion field", () => {
  const base = {
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень",
    bodyMarkdown: null,
    prescriptions: [],
    structuredRx: 1,
  };

  it("the visit screen does not ask about the text; the conclusion card does", () => {
    expect(emptyConclusionSections(base, { requireConclusion: false })).toEqual([]);
    expect(emptyConclusionSections(base)).toEqual(["conclusion"]);
    expect(
      emptyConclusionSections(
        { ...base, diagnosisCode: null, diagnosisName: null, structuredRx: 0 },
        { requireConclusion: false },
      ),
    ).toEqual(["diagnosis", "prescriptions"]);
  });

  it("text alone still makes a draft worth signing", () => {
    expect(
      draftHasContent({ ...base, diagnosisCode: null, diagnosisName: null, structuredRx: 0, bodyMarkdown: "Текст" }),
    ).toBe(true);
  });
});

// ── The screen ───────────────────────────────────────────────────────

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor/reception", rel), "utf8");

describe("the screen", () => {
  it("templates go through the headless channel, mounted with the session", () => {
    const session = read("_components/session-tab-content.tsx");
    expect(session).toContain("<ConclusionTemplateChannel />");
    const channel = read("_components/conclusion-template-channel.tsx");
    expect(channel).toContain("appendSnippet(body, text)");
    // Several texts in one request, one save (review of 03.10.2026).
    expect(channel).toContain("texts.reduce((cur, text) => removeSnippet(cur, text), body)");
    // A request left in the context by an earlier mount is not applied again.
    expect(channel).toContain("React.useRef(bodyAppendRequest?.nonce ?? 0)");
  });

  it("«Предпросмотр» opens the sheet in a dialog from the sign bar", () => {
    const bar = read("_components/visit-action-bar.tsx");
    expect(bar).toContain("<ConclusionPreviewDialog");
    expect(bar).toContain('t("editor.viewPreview")');
    expect(bar).toContain("settleVisitNotePatches(visitNoteId)");
    const dialog = read("_components/conclusion-preview-dialog.tsx");
    expect(dialog).toContain("/print?embed=1");
    expect(dialog).toContain("key={`${noteId}:${updatedAt}`}");
  });

  it("the picker: three columns from 440px of card, tabs below, fixed list height", () => {
    const picker = read("_components/prescription-picker.tsx");
    expect(picker).toContain("@container");
    expect(picker).toContain("@min-[440px]:grid-cols-3");
    expect(picker).toContain("@min-[440px]:hidden");
    expect(picker).toContain('t(`rx.picker.col.${key}`)');
    expect(picker).toContain("h-[22rem] overflow-y-auto");
    // A star is a sibling of the add button, never inside it.
    expect(picker).not.toMatch(/role="button"/);
    const ctor = read("_components/prescription-constructor.tsx");
    expect(ctor).toContain("<PrescriptionPicker");
    expect(ctor).toContain("{aboveColumns ?");
    // Search, drawer and column picks share one way in, with his usual dose.
    expect(ctor).toContain("catalogPickRef.current = addFromCatalog");
    expect(ctor).toContain("draftFromCatalogPick(drug, usual?.[drug.id], term)");
  });

  it("the catalog window cannot be widened by its content", () => {
    const drawer = read("_components/catalog-drawer.tsx");
    expect(drawer).toContain("w-[calc(100vw-2rem)] max-w-6xl flex-col");
    expect(drawer).toContain("md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]");
    expect(drawer).toContain("grid-cols-[minmax(0,1fr)]");
    // The add button is outside the scrolling card: always in view.
    const add = drawer.indexOf('t("catalog.addToPrescriptions")');
    const scroll = drawer.indexOf("min-h-0 min-w-0 flex-1 overflow-y-auto");
    expect(scroll).toBeGreaterThan(0);
    expect(add).toBeGreaterThan(drawer.indexOf("</div>", drawer.indexOf("<DrugSimilar")));
    expect(drawer).not.toContain("h-[600px]");
    expect(drawer).not.toMatch(/w-1\/2/);
  });
});

describe("the new words", () => {
  const messages = (loc: string) =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), `src/messages/${loc}.json`), "utf8"),
    ) as Record<string, Record<string, Record<string, unknown>>>;
  const flat = (o: unknown, prefix = ""): Record<string, string> =>
    typeof o === "string"
      ? { [prefix]: o }
      : Object.assign(
          {},
          ...Object.entries(o as Record<string, unknown>).map(([k, v]) =>
            flat(v, prefix ? `${prefix}.${k}` : k),
          ),
        );

  it("ru and uz carry the same keys, and no dashes", () => {
    const pick = (loc: string) => {
      const m = messages(loc);
      const r = m.doctor!.reception as Record<string, Record<string, unknown>>;
      return {
        ...flat(r.rx!.picker, "rx.picker"),
        "actionBar.previewTitle": r.actionBar!.previewTitle as string,
        "actionBar.previewHint": r.actionBar!.previewHint as string,
        "catalog.backToList": (
          m.doctor!.receptionDialogs as Record<string, Record<string, unknown>>
        ).catalog!.backToList as string,
      };
    };
    const ru = pick("ru");
    const uz = pick("uz");
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
    for (const [key, text] of [...Object.entries(ru), ...Object.entries(uz)]) {
      expect(typeof text, key).toBe("string");
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toMatch(/[—–]/);
    }
  });
});
