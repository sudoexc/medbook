/**
 * The visit screen's mouse-first diagnosis and the per-diagnosis memory
 * (clinic request 03.10.2026).
 *
 * The doctor works with the mouse: the diagnosis is picked in a wide window
 * of three columns («Частые», «Мои», «Каталог МКБ» walked chapter → block →
 * code), each one click from the visit as the main or an additional one, at
 * most four; and once the visit has a diagnosis, «Назначения» offers what he
 * usually prescribes and recommends with it («Обычно при <диагноз>»),
 * learned from his own past visits, one click each or «Добавить всё».
 *
 * These tests drive the memory builder, the column data sources (the
 * server's builders, the ICD tree, the client helpers), the memory route's
 * scoping, and pin the wiring in the source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDiagnosisMemory,
  memoryThreshold,
  type MemoryNote,
} from "@/server/catalog/diagnosis-memory";
import {
  buildDiagnosisColumns,
  buildDiagnosisShortlist,
} from "@/server/catalog/shortlist";
import {
  buildIcd10Node,
  icd10Node,
  inRange,
  type Icd10TreeData,
} from "@/server/icd10/tree";
import { ICD10_ENTRIES } from "@/server/icd10/data";
import { ICD10_CHAPTERS } from "@/lib/icd10-chapters";
import {
  adviceChecker,
  diagnosisOnVisitChecker,
  groupNodeRows,
  memoryChipText,
  memoryToAdd,
  starredDiagnosisColumn,
} from "@/app/[locale]/doctor/reception/_hooks/diagnosis-columns";
import {
  defaultDiagnosisRole,
  diagnosisListOf,
  withDiagnosisPickedAs,
} from "@/app/[locale]/doctor/reception/_hooks/diagnosis-list";
import { onVisitChecker } from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";
import { draftFromShortItem } from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import {
  diagnosisMemoryKey,
  diagnosisMemoryTarget,
  type DrugShortItem,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";

const d = (iso: string) => new Date(iso);

// ── The memory builder ───────────────────────────────────────────────

function visit(
  id: string,
  at: string,
  over: Partial<Omit<MemoryNote, "id" | "at">> = {},
): MemoryNote {
  return { id, at: d(at), structured: [], freeText: [], advice: [], ...over };
}

const NIMESIL = (over: Record<string, unknown> = {}) => ({
  drugId: "nimesulide",
  displayName: "Нимесил (нимесулид)",
  dose: "100 мг",
  form: "POWDER",
  strength: "100 мг",
  timesOfDay: ["MORNING", "EVENING"],
  mealRelation: "AFTER_MEAL",
  durationDays: 5,
  ...over,
});
const SUMATRIPTAN = (over: Record<string, unknown> = {}) => ({
  drugId: "sumatriptan",
  displayName: "Суматриптан",
  dose: "50 мг",
  form: "TAB",
  strength: "50 мг",
  timesOfDay: [],
  mealRelation: "NO_MATTER",
  durationDays: null,
  ...over,
});

describe("buildDiagnosisMemory: what he usually gives with a diagnosis", () => {
  it("counts visits, not rows, and keeps his newest wording", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", {
          structured: [NIMESIL({ displayName: "Нимесулид" }), NIMESIL({ dose: "50 мг" })],
        }),
        visit("v2", "2026-09-20", { structured: [NIMESIL()] }),
      ],
    });
    expect(memory.visits).toBe(2);
    expect(memory.prescriptions).toHaveLength(1);
    expect(memory.prescriptions[0]).toMatchObject({
      drugId: "nimesulide",
      label: "Нимесил (нимесулид)",
      count: 2,
    });
  });

  it("offers his most frequent dose and schema, ties to the most recent", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-08-01", { structured: [NIMESIL()] }),
        visit("v2", "2026-08-10", { structured: [NIMESIL()] }),
        visit("v3", "2026-08-20", { structured: [NIMESIL()] }),
        // The latest visit was an unusual patient: one dose for 3 days.
        visit("v4", "2026-09-30", {
          structured: [NIMESIL({ timesOfDay: ["MORNING"], durationDays: 3 })],
        }),
      ],
    });
    expect(memory.prescriptions[0]).toMatchObject({
      lastDose: "100 мг",
      lastForm: "POWDER",
      lastStrength: "100 мг",
      lastTimesOfDay: ["MORNING", "EVENING"],
      lastMealRelation: "AFTER_MEAL",
      lastDurationDays: 5,
      count: 4,
    });

    const tie = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-08-01", { structured: [NIMESIL({ durationDays: 7 })] }),
        visit("v2", "2026-09-01", { structured: [NIMESIL({ durationDays: 10 })] }),
      ],
    });
    expect(tie.prescriptions[0]!.lastDurationDays).toBe(10);
  });

  it("from three visits on, a one-off is not his usual", () => {
    expect(memoryThreshold(0)).toBe(1);
    expect(memoryThreshold(2)).toBe(1);
    expect(memoryThreshold(3)).toBe(2);
    expect(memoryThreshold(10)).toBe(2);
    expect(memoryThreshold(20)).toBe(3);
    expect(memoryThreshold(200)).toBe(30);

    const few = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", { structured: [NIMESIL(), SUMATRIPTAN()] }),
        visit("v2", "2026-09-02", { structured: [NIMESIL()] }),
      ],
    });
    // Two visits: everything he did is all there is to go on.
    expect(few.prescriptions.map((p) => p.drugId)).toEqual(["nimesulide", "sumatriptan"]);

    const more = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", { structured: [NIMESIL(), SUMATRIPTAN()] }),
        visit("v2", "2026-09-02", { structured: [NIMESIL()] }),
        visit("v3", "2026-09-03", { structured: [NIMESIL()], advice: ["Режим сна"] }),
      ],
    });
    expect(more.prescriptions.map((p) => p.drugId)).toEqual(["nimesulide"]);
    expect(more.advice).toEqual([]);
  });

  it("does not count a visit that holds nothing", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", { structured: [SUMATRIPTAN()] }),
        visit("v2", "2026-09-02"),
        visit("v3", "2026-09-03", { advice: ["  "], freeText: [" "] }),
        visit("v4", "2026-09-04", { structured: [SUMATRIPTAN()] }),
      ],
    });
    expect(memory.visits).toBe(2);
    expect(memory.prescriptions[0]).toMatchObject({ drugId: "sumatriptan", count: 2 });
  });

  it("groups free-typed lines by the search's fold and advice by its words", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", {
          freeText: ["Магне B6"],
          advice: ["Ограничить кофе", "Режим сна"],
        }),
        visit("v2", "2026-09-10", {
          freeText: ["Магне® В6"],
          advice: ["ограничить  кофе", "Ограничить кофе"],
        }),
        visit("v3", "2026-09-20", {
          freeText: ["Магне B6"],
          advice: ["Режим сна, 8 часов"],
        }),
      ],
    });
    expect(memory.prescriptions).toHaveLength(1);
    expect(memory.prescriptions[0]).toMatchObject({
      drugId: null,
      label: "Магне B6",
      count: 3,
      lastDose: null,
    });
    // Twice on two visits counts two, his newest wording leads.
    expect(memory.advice).toEqual([{ line: "ограничить  кофе", count: 2 }]);
  });

  it("ranks by visits, then recency, and stays within its limits", () => {
    const notes = Array.from({ length: 6 }, (_, i) =>
      visit(`v${i}`, `2026-09-0${i + 1}`, {
        structured: Array.from({ length: 20 }, (_, k) => ({
          drugId: `drug-${k}`,
          displayName: `Препарат ${k}`,
          dose: "1 таб.",
        })),
        advice: Array.from({ length: 15 }, (_, k) => `Совет ${k}`),
      }),
    );
    notes[5]!.structured = [
      { drugId: "rare", displayName: "Редкий", dose: "1 таб." },
      ...notes[5]!.structured,
    ];
    const memory = buildDiagnosisMemory({ notes });
    expect(memory.prescriptions).toHaveLength(12);
    expect(memory.advice).toHaveLength(10);
    expect(memory.prescriptions.some((p) => p.drugId === "rare")).toBe(false);
    expect(memory.prescriptions.every((p) => p.count === 6)).toBe(true);
  });
});

// ── «Частые» and «Мои» on the server ─────────────────────────────────

describe("buildDiagnosisColumns", () => {
  const nameForCode = (code: string) =>
    ({ "G43.0": "Мигрень без ауры", "G44.2": "Головная боль напряженного типа", "R51": "Головная боль" })[
      code
    ] ?? null;
  const uses = [
    { code: "G43.0", name: "Мигрень без ауры", at: d("2026-09-01") },
    { code: "G43.0", name: "Мигрень без ауры", at: d("2026-09-02") },
    { code: "G44.2", name: "ГБН", at: d("2026-09-03") },
    { code: null, name: "Тиннитус", at: d("2026-09-04") },
  ];

  it("«Частые» is his history, stars marked but never pushing it out", () => {
    const { frequent } = buildDiagnosisColumns({
      pinnedCodes: ["g44.2", "R51"],
      uses,
      nameForCode,
      frequentLimit: 30,
    });
    expect(frequent.map((r) => [r.code, r.count, r.pinned])).toEqual([
      ["G43.0", 2, false],
      [null, 1, false],
      ["G44.2", 1, true],
    ]);
  });

  it("«Мои» is his stars in his order, named, an unknown code dropped", () => {
    const { starred } = buildDiagnosisColumns({
      pinnedCodes: ["R51", "g44.2", "X99.9", "R51"],
      uses,
      nameForCode,
      frequentLimit: 30,
    });
    expect(starred).toEqual([
      { code: "R51", name: "Головная боль", count: 0, pinned: true },
      { code: "G44.2", name: "ГБН", count: 1, pinned: true },
    ]);
  });

  it("the shortlist still counts the same way", () => {
    const rows = buildDiagnosisShortlist({
      pinnedCodes: ["R51"],
      uses,
      nameForCode,
      limit: 10,
    });
    expect(rows.map((r) => r.code)).toEqual(["R51", "G43.0", null, "G44.2"]);
  });
});

// ── «Каталог МКБ»: the tree ──────────────────────────────────────────

describe("the ICD-10 tree", () => {
  const fixture: Icd10TreeData = {
    chapters: ["A00-B99"],
    blocks: [
      { range: "A00-A09", nameRu: "Кишечные инфекции", parent: "A00-B99" },
      { range: "A15-A19", nameRu: "Туберкулез", parent: "A00-B99" },
      { range: "A15-A16", nameRu: "Туберкулез органов дыхания", parent: "A15-A19" },
    ],
    headings: [
      { code: "A00", nameRu: "Холера" },
      { code: "A15", nameRu: "Туберкулез, подтвержденный" },
    ],
    entries: [
      { code: "A00.0", nameRu: "Холера классическая" },
      { code: "A00.9", nameRu: "Холера неуточненная" },
      { code: "A09", nameRu: "Диарея" },
      { code: "A15.0", nameRu: "Туберкулез легких" },
      { code: "A17.0", nameRu: "Туберкулезный менингит" },
      { code: "B99", nameRu: "Другие инфекционные болезни" },
    ],
  };

  it("a node lists its child blocks and the codes outside them", () => {
    const chapter = buildIcd10Node("A00-B99", fixture)!;
    expect(chapter.blocks).toEqual([
      { range: "A00-A09", nameRu: "Кишечные инфекции", count: 3 },
      { range: "A15-A19", nameRu: "Туберкулез", count: 2 },
    ]);
    expect(chapter.rows.map((r) => r.code)).toEqual(["B99"]);

    const nested = buildIcd10Node("A15-A19", fixture)!;
    expect(nested.blocks.map((b) => b.range)).toEqual(["A15-A16"]);
    expect(nested.rows.map((r) => r.code)).toEqual(["A17.0"]);

    const leaf = buildIcd10Node("A00-A09", fixture)!;
    expect(leaf.blocks).toEqual([]);
    expect(leaf.rows.map((r) => r.code)).toEqual(["A00.0", "A00.9", "A09"]);
    expect(leaf.headings).toEqual([{ code: "A00", nameRu: "Холера" }]);

    expect(buildIcd10Node("A20-A28", fixture)).toBeNull();
    expect(inRange("A15.0", "A15-A19")).toBe(true);
    expect(inRange("A20.0", "A15-A19")).toBe(false);
  });

  it("every code of the catalog is reachable from the chapters, exactly once", () => {
    const reached = new Map<string, number>();
    const walk = (range: string) => {
      const node = icd10Node(range);
      expect(node, range).not.toBeNull();
      for (const r of node!.rows) reached.set(r.code, (reached.get(r.code) ?? 0) + 1);
      for (const b of node!.blocks) {
        expect(b.count, b.range).toBeGreaterThan(0);
        walk(b.range);
      }
    };
    for (const c of ICD10_CHAPTERS) walk(c.id);
    expect(reached.size).toBe(ICD10_ENTRIES.length);
    expect([...reached.values()].every((n) => n === 1)).toBe(true);
  });

  it("chapter G opens on its blocks, and migraine sits under its title", () => {
    const g = icd10Node("g00-g99")!;
    expect(g.blocks.map((b) => b.range)).toContain("G40-G47");
    expect(g.blocks.find((b) => b.range === "G40-G47")!.nameRu).toBe(
      "Эпизодические и пароксизмальные расстройства",
    );
    const block = icd10Node("G40-G47")!;
    expect(block.rows.map((r) => r.code)).toContain("G43.0");
    const groups = groupNodeRows(block.rows, block.headings);
    const migraine = groups.find((x) => x.heading?.code === "G43")!;
    expect(migraine.heading!.nameRu).toBe("Мигрень");
    expect(migraine.rows[0]!.code).toBe("G43.0");
    // A block's list fits one answer (the column never pages).
    for (const c of ICD10_CHAPTERS) {
      for (const b of icd10Node(c.id)!.blocks) {
        expect(icd10Node(b.range)!.rows.length, b.range).toBeLessThanOrEqual(400);
      }
    }
  });

  it("names its blocks in plain case and without dashes", () => {
    for (const c of ICD10_CHAPTERS) {
      for (const b of icd10Node(c.id)!.blocks) {
        expect(b.nameRu, b.range).not.toMatch(/[—–]/);
        // Sentence case: not a heading shouted in capitals.
        expect(b.nameRu.slice(1), b.range).toMatch(/[а-яё]/);
      }
    }
    expect(icd10Node("B20-B24")!.rows.length).toBeGreaterThan(0);
    expect(icd10Node("A00-B99")!.blocks.find((b) => b.range === "B20-B24")!.nameRu).toContain(
      "[ВИЧ]",
    );
    expect(icd10Node("Z99-A00")).toBeNull();
    expect(icd10Node("nonsense")).toBeNull();
  });
});

// ── The client's helpers ─────────────────────────────────────────────

describe("the picker's columns on the client", () => {
  it("«Мои» follows the live stars, naming a fresh one from where it was starred", () => {
    const starred = [{ code: "R51", name: "Головная боль", count: 0, pinned: true }];
    const known = [{ code: "G43.0", name: "Мигрень без ауры", count: 4, pinned: false }];
    expect(
      starredDiagnosisColumn({ favorites: null, starred, known, seen: new Map() }),
    ).toEqual(starred);
    const col = starredDiagnosisColumn({
      favorites: ["g43.0", "R51", "M54.5", "Z00.0"],
      starred,
      known,
      seen: new Map([["M54.5", "Боль внизу спины"]]),
    });
    expect(col.map((x) => [x.code, x.name, x.pinned])).toEqual([
      ["G43.0", "Мигрень без ауры", true],
      ["R51", "Головная боль", true],
      ["M54.5", "Боль внизу спины", true],
    ]);
  });

  it("a diagnosis on the visit is marked by its code or its words", () => {
    const onVisit = diagnosisOnVisitChecker([
      { code: "G43.0", name: "Мигрень без ауры" },
      { code: null, name: "Тиннитус" },
    ]);
    expect(onVisit({ code: "g43.0", name: "другие слова" })).toBe(true);
    expect(onVisit({ code: null, name: " тиннитус " })).toBe(true);
    expect(onVisit({ code: "G44.2", name: "ГБН" })).toBe(false);
  });

  it("codes that are categories run together under no title", () => {
    const groups = groupNodeRows(
      [
        { code: "G20", nameRu: "Болезнь Паркинсона" },
        { code: "G21.0", nameRu: "Злокачественный нейролептический синдром" },
        { code: "G21.1", nameRu: "Другие формы" },
        { code: "G22", nameRu: "Паркинсонизм" },
      ],
      [{ code: "G21", nameRu: "Вторичный паркинсонизм" }],
    );
    expect(groups.map((g) => [g.heading?.code ?? null, g.rows.length])).toEqual([
      [null, 1],
      ["G21", 2],
      [null, 1],
    ]);
  });

  it("one click picks it as the main or an additional diagnosis, four at most", () => {
    const empty = { diagnosisCode: null, diagnosisName: null, additionalDiagnoses: [] };
    expect(defaultDiagnosisRole(empty)).toBe("main");
    const one = withDiagnosisPickedAs(empty, { code: "G43.0", name: "Мигрень" }, "additional")!;
    expect(one).toMatchObject({ diagnosisCode: "G43.0", additionalDiagnoses: [] });
    expect(defaultDiagnosisRole(one)).toBe("additional");

    const two = withDiagnosisPickedAs(one, { code: "G44.2", name: "ГБН" }, "additional")!;
    expect(diagnosisListOf(two).map((x) => x.code)).toEqual(["G43.0", "G44.2"]);

    // «Основной»: the new one leads, the former main one follows it.
    const swapped = withDiagnosisPickedAs(two, { code: "M54.2", name: "Цервикалгия" }, "main")!;
    expect(diagnosisListOf(swapped).map((x) => x.code)).toEqual(["M54.2", "G43.0", "G44.2"]);
    // One already on the visit only moves to the front.
    const moved = withDiagnosisPickedAs(swapped, { code: "G44.2", name: "ГБН" }, "main")!;
    expect(diagnosisListOf(moved).map((x) => x.code)).toEqual(["G44.2", "M54.2", "G43.0"]);
    expect(withDiagnosisPickedAs(moved, { code: "G44.2", name: "ГБН" }, "main")).toBeNull();
    expect(withDiagnosisPickedAs(moved, { code: "G43.0", name: "" }, "additional")).toBeNull();

    const full = withDiagnosisPickedAs(moved, { code: null, name: "Тиннитус" }, "additional")!;
    expect(diagnosisListOf(full)).toHaveLength(4);
    expect(withDiagnosisPickedAs(full, { code: "R51", name: "Головная боль" }, "main")).toBeNull();
    expect(
      withDiagnosisPickedAs(full, { code: "R51", name: "Головная боль" }, "additional"),
    ).toBeNull();
    expect(withDiagnosisPickedAs(empty, { code: " ", name: " " }, "main")).toBeNull();
  });
});

describe("«Обычно при» on the client", () => {
  const item = (over: Partial<DrugShortItem> = {}): DrugShortItem => ({
    key: "nimesulide",
    drugId: "nimesulide",
    label: "Нимесил (нимесулид)",
    count: 5,
    lastDose: "100 мг",
    lastForm: "POWDER",
    lastStrength: "100 мг",
    lastTimesOfDay: ["MORNING", "EVENING"],
    lastMealRelation: "AFTER_MEAL",
    lastDurationDays: 5,
    pinned: false,
    strengths: [],
    drug: {
      id: "nimesulide",
      inn: "nimesulide",
      nameRu: "Нимесулид",
      nameUz: null,
      atcCode: "M01AX17",
      category: "NSAID",
      forms: [{ form: "POWDER", strengths: ["100 мг"] }],
      defaultDosing: null,
      rxOnly: true,
      brands: [],
    },
    ...over,
  });

  it("the chip reads the very row a click adds, without a dash", () => {
    const { head, schedule } = memoryChipText(item(), "ru");
    expect(head).toBe("Нимесил (нимесулид)");
    expect(schedule).toBe("100 мг, утром и вечером, после еды, 5 дн.");
    const { draft } = draftFromShortItem(item(), "mine");
    expect(draft).toMatchObject({
      drugId: "nimesulide",
      dose: "100 мг",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 5,
    });
    expect(`${head} ${schedule}`).not.toMatch(/[—–]/);
    expect(memoryChipText(item(), "uz").schedule).toBe(
      "100 мг, ertalab va kechqurun, ovqatdan keyin, 5 kun",
    );
  });

  it("a manual row of his comes back with its dose and schema", () => {
    const manual = item({
      key: "text:магне в6",
      drugId: null,
      drug: null,
      label: "Магне B6",
      lastDose: "2 таб.",
      lastForm: null,
      lastStrength: null,
      lastDurationDays: 30,
    });
    const { draft } = draftFromShortItem(manual, "mine");
    expect(draft).toMatchObject({
      drugId: null,
      displayName: "Магне B6",
      dose: "2 таб.",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 30,
    });
  });

  it("«Добавить всё» adds only what the visit does not hold yet", () => {
    const memory = {
      prescriptions: [
        item(),
        item({ key: "sumatriptan", drugId: "sumatriptan", label: "Суматриптан", drug: null }),
        item({ key: "text:магне", drugId: null, label: "Магне B6", drug: null }),
      ],
      advice: [
        { line: "Ограничить кофе", count: 3 },
        { line: "Режим сна", count: 2 },
      ],
    };
    const rxOnVisit = onVisitChecker(
      [{ drugId: "nimesulide", displayName: "Нимесулид" }],
      ["Магне® В6"],
    );
    const adviceOnVisit = adviceChecker(["режим  сна"]);
    const todo = memoryToAdd(memory, rxOnVisit, adviceOnVisit);
    expect(todo.items.map((i) => i.key)).toEqual(["sumatriptan"]);
    expect(todo.lines).toEqual(["Ограничить кофе"]);
  });

  it("asks the server about a diagnosis by its code, or by its words", () => {
    expect(diagnosisMemoryTarget({ code: " g43.0 ", name: "Мигрень" })).toEqual({ code: "G43.0" });
    expect(diagnosisMemoryTarget({ code: null, name: "  Тиннитус  справа " })).toEqual({
      name: "Тиннитус справа",
    });
    expect(diagnosisMemoryTarget({ code: " ", name: " " })).toBeNull();
    expect(diagnosisMemoryKey({ code: "G43.0" }, "vn_1")).toEqual([
      "doctor",
      "reception",
      "dx-memory",
      "code:G43.0",
      "vn_1",
    ]);
    expect(diagnosisMemoryKey({ name: "Тиннитус" }, null)[3]).toBe("text:тиннитус");
  });
});

// ── The memory route: scoped, bounded, wired ─────────────────────────

const db = vi.hoisted(() => ({
  noteArgs: [] as Record<string, unknown>[],
  notes: [] as Record<string, unknown>[],
  doctor: { id: "doc_1" } as { id: string } | null,
  moved: 0,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => db.doctor) },
    visitNote: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        db.noteArgs.push(args);
        return db.notes;
      }),
    },
  },
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "DOCTOR" },
      }),
}));

vi.mock("@/server/catalog/formulary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog/formulary")>()),
  loadFormulary: vi.fn(async () => [
    { drugId: "nimesulide", label: "Нимесил", aliases: [], strengths: ["100 мг"], sortOrder: 0 },
  ]),
}));

vi.mock("@/server/catalog/drug-hits", () => ({
  loadDrugHits: vi.fn(async (ids: string[]) => {
    // A drug hidden by the clinic since is not among the hits.
    const visible = ids.filter((id) => id !== "hidden");
    return new Map(visible.map((id) => [id, { id, nameRu: id, forms: [], brands: [] }]));
  }),
}));

vi.mock("@/server/catalog/moved-brands", () => ({
  followMovedBrands: vi.fn(async (uses: unknown[]) => {
    db.moved += 1;
    return uses;
  }),
}));

import { GET as memoryRoute } from "@/app/api/crm/doctors/me/diagnosis-memory/route";

async function askMemory(params: Record<string, string>) {
  const url = new URL("http://x/api/crm/doctors/me/diagnosis-memory");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return memoryRoute(new Request(url));
}

describe("GET /api/crm/doctors/me/diagnosis-memory", () => {
  beforeEach(() => {
    db.noteArgs = [];
    db.notes = [];
    db.doctor = { id: "doc_1" };
    db.moved = 0;
  });

  const row = (over: Record<string, unknown>) => ({
    drugId: null,
    displayName: "",
    dose: "",
    form: null,
    strength: null,
    timesOfDay: [],
    mealRelation: "NO_MATTER",
    durationDays: null,
    ...over,
  });

  it("reads his own notes with the main code, the last year, 200 at most, without this visit", async () => {
    db.notes = [
      {
        id: "n2",
        createdAt: d("2026-09-20"),
        prescriptions: [],
        advice: ["Режим сна"],
        visitPrescriptions: [row(NIMESIL()), row({ drugId: "hidden", displayName: "Скрытый", dose: "1 таб." })],
      },
      {
        id: "n1",
        createdAt: d("2026-09-01"),
        prescriptions: ["Мексидол 5,0 в/м №10"],
        advice: [],
        visitPrescriptions: [row(NIMESIL())],
      },
    ];
    const before = Date.now();
    const res = await askMemory({ code: "g43.0", exclude: "vn_now" });
    expect(res.status).toBe(200);
    const args = db.noteArgs[0] as {
      where: Record<string, unknown> & { createdAt: { gte: Date } };
      take: number;
      orderBy: unknown;
    };
    expect(args.where).toMatchObject({
      doctorId: "doc_1",
      id: { not: "vn_now" },
      diagnosisCode: { equals: "g43.0", mode: "insensitive" },
    });
    const days = (before - args.where.createdAt.gte.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
    expect(args.take).toBe(200);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(db.moved).toBe(1);

    const body = (await res.json()) as {
      visits: number;
      prescriptions: Array<{ drugId: string | null; label: string; count: number; strengths: string[]; drug: unknown }>;
      advice: Array<{ line: string }>;
    };
    expect(body.visits).toBe(2);
    expect(body.prescriptions.map((p) => [p.drugId, p.count])).toEqual([
      ["nimesulide", 2],
      ["hidden", 1],
      [null, 1],
    ]);
    expect(body.prescriptions[0]).toMatchObject({ strengths: ["100 мг"], drug: { id: "nimesulide" } });
    // Hidden since: it comes back as his text line, no catalog row.
    expect(body.prescriptions[1]!.drug).toBeNull();
    expect(body.advice.map((a) => a.line)).toEqual(["Режим сна"]);
  });

  it("a diagnosis without a code is found by its words", async () => {
    await askMemory({ name: "Тиннитус" });
    expect((db.noteArgs[0] as { where: Record<string, unknown> }).where).toMatchObject({
      doctorId: "doc_1",
      diagnosisCode: null,
      diagnosisName: { equals: "Тиннитус", mode: "insensitive" },
    });
    expect((db.noteArgs[0] as { where: Record<string, unknown> }).where).not.toHaveProperty("id");
  });

  it("refuses a request that names no diagnosis, and a user with no doctor card", async () => {
    expect((await askMemory({})).status).toBe(400);
    db.doctor = null;
    expect((await askMemory({ code: "G43.0" })).status).toBe(403);
    expect(db.noteArgs).toHaveLength(0);
  });
});

// ── The screen ───────────────────────────────────────────────────────

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor", rel), "utf8");

describe("the visit screen wiring", () => {
  it("the left panel opens the picker; the conclusion page keeps the search", () => {
    const panels = read("reception/_components/structured-fields-panel.tsx");
    const left = panels.slice(
      panels.indexOf("export function DiagnosisFollowUpPanel"),
      panels.indexOf("export function PrescriptionsPanel"),
    );
    expect(left).toContain("onOpenPicker={() => setPickerOpen(true)}");
    expect(left).toContain("<DiagnosisPickerDialog");
    expect(left).not.toContain("IcdCatalogDrawer");
    const card = read("_components/diagnosis-follow-up-cards.tsx");
    expect(card).toContain("const showSearch = !onOpenPicker && !disabled");
    expect(card).toContain("onClick={() => (onOpenPicker ? onOpenPicker() : setAdding(true))}");
    const detail = read("conclusions/[id]/_components/conclusion-detail.tsx");
    expect(detail).not.toContain("onOpenPicker");
  });

  it("the picker has three columns, tabs on a phone, and a way out that is never hidden", () => {
    const dialog = read("reception/_components/diagnosis-picker-dialog.tsx");
    expect(dialog).toContain(
      "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]",
    );
    expect(dialog).toContain('t(`diagnosis.picker.col.${key}`)');
    expect(dialog).toContain("md:hidden");
    expect(dialog).toContain("withDiagnosisPickedAs(live, d, role)");
    expect(dialog).toContain("w-[calc(100vw-2rem)] max-w-6xl flex-col");
    expect(dialog).toContain('t("diagnosis.picker.done")');
    // Rows are big targets and the star is its own button.
    expect(dialog).toContain("min-h-14");
    expect(dialog).not.toMatch(/role="button"/);
  });

  it("«Назначения» carries «Обычно при <диагноз>» above the columns", () => {
    const panels = read("reception/_components/structured-fields-panel.tsx");
    const middle = panels.slice(panels.indexOf("export function PrescriptionsPanel"));
    expect(middle).toMatch(/aboveColumns=\{\(pickApi\) => \(\s*<DiagnosisMemoryCard/);
    expect(middle).toContain('mutateChips("advice"');
    const ctor = read("reception/_components/prescription-constructor.tsx");
    expect(ctor).toContain("{aboveColumns ? (");
    expect(ctor).toContain("addItem: addFromShort");
    expect(ctor).toContain("onSaveRows([...liveDrafts(), ...drafts])");
    const card = read("reception/_components/diagnosis-memory-card.tsx");
    expect(card).toContain("useDiagnosisMemories(diagnoses, note.id)");
    expect(card).toContain("pickApi.addItems(pending.items)");
  });
});

describe("the new words", () => {
  const messages = (loc: string) =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), `src/messages/${loc}.json`), "utf8"),
    ) as { doctor: { reception: Record<string, Record<string, unknown>> } };
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
      const r = messages(loc).doctor.reception;
      return {
        ...flat(r.diagnosis!.picker, "diagnosis.picker"),
        ...flat(r.memory, "memory"),
      };
    };
    const ru = pick("ru");
    const uz = pick("uz");
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
    expect(Object.keys(ru).length).toBeGreaterThan(20);
    for (const [key, text] of [...Object.entries(ru), ...Object.entries(uz)]) {
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toMatch(/[—–]/);
    }
  });
});
