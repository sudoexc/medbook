/**
 * «Мой арсенал» (owner request 03.10.2026: «чтобы система прям знала каждого
 * врача самые частые 10-20-30 назначений и диагнозов, чтобы им максимально
 * было удобно работать с их постоянным арсеналом, мышкой»).
 *
 *   1. Ranking: «Частые» is his top 30 by count, ties to the most recent,
 *      drafts and every diagnosis of a note included, text lines counted
 *      for the catalog drug the matcher places them on.
 *   2. Fallback: fewer of his own than he chose to see → the clinic's core
 *      list carries the drug column on, in clinic-wide use order.
 *   3. The arsenal: order (positions, a drag's permutation), the drug
 *      schema (cleaned when read, applied by one click from «Мои», never
 *      to «Частые»), the «10 · 20 · 30» choice.
 *   4. Who may edit: the doctor his own, the clinic's ADMIN any doctor of
 *      that clinic, nobody across clinics.
 *   5. The migration: additive only, safe on existing rows.
 *   6. On screen: the switch, the count pills, the core list heading, the
 *      clinic's diagnoses for a doctor with none; ru and uz in parity.
 */
import * as React from "react";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  ARSENAL_MAX,
  DEFAULT_FREQUENT_LIMIT,
  canManageArsenal,
  frequentWithCore,
  isEmptyDrugSchema,
  nextArsenalPosition,
  normalizeFrequentLimit,
  orderArsenal,
  parseDrugArsenalSchema,
  rankCoreByUse,
  reorderedPositions,
  type DrugArsenalSchema,
} from "@/lib/arsenal";
import {
  buildDiagnosisColumns,
  buildDrugColumns,
  buildDrugShortlist,
  noteDiagnosisUses,
} from "@/server/catalog/shortlist";
import {
  frequentColumn,
  starredColumn,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";
import {
  draftFromShortItem,
  shortItemFromDrug,
  shortItemKind,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import type { DrugSearchHit } from "@/app/[locale]/doctor/reception/_hooks/use-drug-search";
import {
  diagnosisShortlistKey,
  drugShortlistKey,
  type DiagnosisShortlist,
  type DrugShortItem,
  type DrugShortlist,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";
import { doctorFavoritesKey } from "@/app/[locale]/doctor/reception/_hooks/use-doctor-favorites";
import type { VisitNoteRow } from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";
import { DiagnosisPicker } from "@/app/[locale]/doctor/reception/_components/diagnosis-picker";
import { PrescriptionPicker } from "@/app/[locale]/doctor/reception/_components/prescription-picker";
import {
  arsenalKey,
  withAdded,
  withOrder,
  withRemoved,
  withSchema,
  type DiagnosisArsenal,
  type DrugArsenal,
} from "@/components/arsenal/use-arsenal";
import { ArsenalEditor } from "@/components/arsenal/arsenal-editor";

const d = (iso: string) => new Date(iso);
const root = process.cwd();
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

function hit(id: string, over: Partial<DrugSearchHit> = {}): DrugSearchHit {
  return {
    id,
    inn: id,
    nameRu: id,
    nameUz: null,
    atcCode: null,
    category: "OTHER",
    forms: [
      { form: "TAB", strengths: ["50 мг", "150 мг"] },
      { form: "AMP", strengths: ["100 мг/мл"] },
    ],
    defaultDosing: null,
    rxOnly: true,
    brands: [],
    ...over,
  };
}

// ── 1. Ranking ───────────────────────────────────────────────────────────

describe("«Частые»: his top by count, ties to the most recent", () => {
  it("a text line the matcher places on a drug counts with its rows; the dose stays the rows'", () => {
    const { frequent, usual } = buildDrugColumns({
      pinnedIds: [],
      structured: [
        { drugId: "mexidol", displayName: "Мексидол", dose: "125 мг", timesOfDay: ["MORNING"], at: d("2026-09-01") },
        { drugId: "nimesulide", displayName: "Найз", dose: "100 мг", at: d("2026-09-02") },
        { drugId: "nimesulide", displayName: "Найз", dose: "100 мг", at: d("2026-09-03") },
      ],
      freeText: [
        // An old preset's line and a quick-entry line: both are Мексидол.
        { line: "Мексидол 5,0 в/м №10", at: d("2026-09-20"), drugId: "mexidol" },
        { line: "Мексидол 125 мг 1 таб 2 р/д", at: d("2026-09-21"), drugId: "mexidol" },
      ],
      frequentLimit: 30,
      usualLimit: 300,
    });
    expect(frequent.map((f) => [f.drugId, f.count])).toEqual([
      ["mexidol", 3],
      ["nimesulide", 2],
    ]);
    // His wording and dose come from the row, never from a line.
    expect(frequent[0]).toMatchObject({ label: "Мексидол", lastDose: "125 мг", lastTimesOfDay: ["MORNING"] });
    expect(frequent[0]).not.toHaveProperty("lineOnly");
    expect(usual.get("mexidol")?.lastDose).toBe("125 мг");
  });

  it("a drug he only ever wrote as a line is that drug, labelled with his newest line, and gives no «usual»", () => {
    const { frequent, usual, starred } = buildDrugColumns({
      pinnedIds: ["cinnarizine"],
      structured: [],
      freeText: [
        { line: "Циннаризин 25 мг 3 р/д", at: d("2026-09-01"), drugId: "cinnarizine" },
        { line: "Циннаризин 25 мг 2 р/д", at: d("2026-09-05"), drugId: "cinnarizine" },
        { line: "Мумиё", at: d("2026-09-06"), drugId: null },
      ],
      frequentLimit: 30,
      usualLimit: 300,
    });
    expect(frequent[0]).toMatchObject({
      key: "cinnarizine",
      drugId: "cinnarizine",
      label: "Циннаризин 25 мг 2 р/д",
      count: 2,
      lineOnly: true,
    });
    // A line the catalog cannot place stays a text entry, as before.
    expect(frequent[1]).toMatchObject({ key: expect.stringMatching(/^text:/), drugId: null });
    expect(frequent[1]).not.toHaveProperty("lineOnly");
    // As a «usual» the whole line would rename a catalog pick.
    expect(usual.has("cinnarizine")).toBe(false);
    // His star is the drug, carrying his count, named later from the catalog.
    expect(starred[0]).toMatchObject({ drugId: "cinnarizine", label: "", count: 2, pinned: true });
    expect(starred[0]).not.toHaveProperty("lineOnly");
  });

  it("equal counts go to the most recent; the column holds 30 at most", () => {
    const structured = Array.from({ length: 40 }, (_, i) => ({
      drugId: `drug${i}`,
      displayName: `Препарат ${i}`,
      dose: "1 таб.",
      at: d(`2026-0${(i % 9) + 1}-1${i % 10}`),
    }));
    // drug7 twice: first by count.
    structured.push({ drugId: "drug7", displayName: "Препарат 7", dose: "1 таб.", at: d("2026-01-01") });
    const { frequent } = buildDrugColumns({
      pinnedIds: [],
      structured,
      freeText: [],
      frequentLimit: 30,
      usualLimit: 300,
    });
    expect(frequent).toHaveLength(30);
    expect(frequent[0]!.drugId).toBe("drug7");
    const times = frequent.slice(1).map((f) => f.count);
    expect(new Set(times)).toEqual(new Set([1]));

    // Same count: the one he wrote last comes first.
    const tie = buildDrugColumns({
      pinnedIds: [],
      structured: [
        { drugId: "old", displayName: "Old", dose: null, at: d("2026-03-01") },
        { drugId: "new", displayName: "New", dose: null, at: d("2026-09-01") },
        { drugId: "mid", displayName: "Mid", dose: null, at: d("2026-06-01") },
      ],
      freeText: [],
      frequentLimit: 30,
      usualLimit: 300,
    });
    expect(tie.frequent.map((f) => f.drugId)).toEqual(["new", "mid", "old"]);
  });

  it("the old shortlist keeps a line-only star as the bare drug", () => {
    const rows = buildDrugShortlist({
      pinnedIds: ["cinnarizine"],
      structured: [],
      freeText: [{ line: "Циннаризин 25 мг", at: d("2026-09-01"), drugId: "cinnarizine" }],
      limit: 12,
    });
    expect(rows[0]).toMatchObject({ drugId: "cinnarizine", label: "", count: 1, pinned: true });
  });

  it("diagnoses: the main one and the others, drafts included, top 30", () => {
    const notes = Array.from({ length: 35 }, (_, i) => ({
      diagnosisCode: `G${String(10 + i).padStart(2, "0")}.0`,
      diagnosisName: `Диагноз ${i}`,
      additionalDiagnoses: i < 3 ? [{ code: "G44.2", name: "ГБН" }] : [],
      createdAt: d(`2026-09-${String((i % 28) + 1).padStart(2, "0")}`),
    }));
    const { frequent } = buildDiagnosisColumns({
      pinnedCodes: [],
      uses: notes.flatMap(noteDiagnosisUses),
      nameForCode: () => null,
      frequentLimit: 30,
    });
    expect(frequent).toHaveLength(30);
    // Three times as the second diagnosis: first.
    expect(frequent[0]).toMatchObject({ code: "G44.2", count: 3 });
  });
});

// ── 2. Fallback ──────────────────────────────────────────────────────────

const item = (id: string, over: Partial<DrugShortItem> = {}): DrugShortItem => ({
  ...shortItemFromDrug(hit(id), undefined),
  ...over,
});

describe("a short «Частые» continues with the clinic's core list", () => {
  it("his own first, then the core list up to N, each drug once", () => {
    const own = [item("mexidol", { count: 5 }), item("nimesulide", { count: 2 })];
    const core = ["nimesulide", "pregabalin", "amitriptyline", "betahistine"].map((id) => item(id));
    const view = frequentWithCore(own, core, 4);
    expect(view.own.map((i) => i.drugId)).toEqual(["mexidol", "nimesulide"]);
    expect(view.core.map((i) => i.drugId)).toEqual(["pregabalin", "amitriptyline"]);
  });

  it("enough of his own: no core list at all", () => {
    const own = Array.from({ length: 25 }, (_, i) => item(`d${i}`, { count: 30 - i }));
    const view = frequentWithCore(own, [item("pregabalin")], 20);
    expect(view.own).toHaveLength(20);
    expect(view.core).toEqual([]);
  });

  it("the core list goes in clinic-wide use order, unused ones in the clinic's order", () => {
    const ids = ["a", "b", "c", "d"];
    expect(rankCoreByUse(ids, new Map([["c", 7], ["b", 2]]))).toEqual(["c", "b", "a", "d"]);
    const view = frequentColumn({
      frequent: [],
      core: ids.map((id) => item(id)),
      coreRank: ["c", "b", "a", "d"],
      limit: 10,
    });
    expect(view.core.map((i) => i.drugId)).toEqual(["c", "b", "a", "d"]);
    // An older server without a rank: the clinic's order.
    expect(
      frequentColumn({ frequent: [], core: ids.map((id) => item(id)), coreRank: [], limit: 2 }).core.map(
        (i) => i.drugId,
      ),
    ).toEqual(["a", "b"]);
  });

  it("the choice is 10, 20 or 30, 20 by default", () => {
    expect(DEFAULT_FREQUENT_LIMIT).toBe(20);
    expect(normalizeFrequentLimit(10)).toBe(10);
    expect(normalizeFrequentLimit("30")).toBe(30);
    expect(normalizeFrequentLimit(25)).toBe(20);
    expect(normalizeFrequentLimit(null)).toBe(20);
  });
});

// ── 3. The arsenal ───────────────────────────────────────────────────────

describe("arsenal order", () => {
  it("by position, the older first on a tie, each code once", () => {
    const pins = orderArsenal([
      { entityCode: "b", sortOrder: 1_790_000_000, createdAt: d("2026-10-01T10:00:00Z") },
      { entityCode: "a", sortOrder: 1_790_000_000, createdAt: d("2026-10-01T09:00:00Z") },
      { entityCode: "c", sortOrder: 0, createdAt: d("2026-10-02") },
      { entityCode: "a", sortOrder: 5, createdAt: d("2026-10-02") },
    ]);
    expect(pins.map((p) => p.entityCode)).toEqual(["c", "a", "b"]);
  });

  it("a drag writes 0..n-1, and only a permutation of what is there", () => {
    expect(reorderedPositions(["a", "b", "c"], ["c", "a", "b"])).toEqual({
      ok: true,
      positions: [
        { entityCode: "c", sortOrder: 0 },
        { entityCode: "a", sortOrder: 1 },
        { entityCode: "b", sortOrder: 2 },
      ],
    });
    // A pin added or removed meanwhile, a duplicate, a stranger: refused.
    expect(reorderedPositions(["a", "b", "c"], ["c", "a"]).ok).toBe(false);
    expect(reorderedPositions(["a", "b"], ["a", "b", "x"]).ok).toBe(false);
    expect(reorderedPositions(["a", "b"], ["a", "a"]).ok).toBe(false);
  });

  it("a new pin lands after every other, whether positions are small or epoch seconds", () => {
    const now = Date.UTC(2026, 9, 3) ;
    expect(nextArsenalPosition([{ sortOrder: 0 }, { sortOrder: 1 }], now)).toBe(Math.floor(now / 1000));
    expect(nextArsenalPosition([{ sortOrder: Math.floor(now / 1000) + 5 }], now)).toBe(
      Math.floor(now / 1000) + 6,
    );
    expect(ARSENAL_MAX).toBe(30);
  });

  it("the page's optimistic edits: add at the end and out of the sources, remove, drag, schema", () => {
    const cur = {
      items: [{ code: "a" }, { code: "b" }],
      top: [{ drugId: "c" }, { drugId: "x" }],
      core: [{ drugId: "c" }],
    };
    const added = withAdded("DRUG", cur, "c", { drugId: "c", label: "C" }) as typeof cur & {
      items: Array<{ code: string; schema?: unknown; entry?: unknown }>;
    };
    expect(added.items.map((i) => i.code)).toEqual(["a", "b", "c"]);
    expect(added.items[2]).toMatchObject({ schema: null, entry: { drugId: "c" } });
    expect(added.top).toEqual([{ drugId: "x" }]);
    expect(added.core).toEqual([]);
    expect(withAdded("DRUG", cur, "a", null)).toBe(cur);
    expect((withRemoved(cur, "a") as typeof cur).items).toEqual([{ code: "b" }]);
    expect((withOrder(cur, ["b", "a"]) as typeof cur).items).toEqual([{ code: "b" }, { code: "a" }]);
    const schema = parseDrugArsenalSchema({ dose: "1 таб." })!;
    expect((withSchema(cur, "b", schema) as { items: unknown[] }).items[1]).toEqual({ code: "b", schema });
    const dx = withAdded("ICD10", { items: [], top: [{ code: "G43.0" }] }, "G43.0", {
      code: "G43.0",
      name: "Мигрень",
      count: 4,
    }) as { items: unknown[]; top: unknown[] };
    expect(dx.items).toEqual([{ code: "G43.0", name: "Мигрень", count: 4 }]);
    expect(dx.top).toEqual([]);
  });
});

describe("the drug schema", () => {
  it("is read tolerantly: unknown values out, times in order, texts trimmed and capped", () => {
    const s = parseDrugArsenalSchema({
      form: "  TAB ",
      strength: "50 мг",
      dose: " 1  таб. ",
      timesOfDay: ["EVENING", "BREAKFAST", "MORNING", "EVENING"],
      mealRelation: "WITH_BEER",
      durationDays: 400,
      instructionRu: "x".repeat(900),
      extra: "ignored",
    });
    expect(s).toEqual({
      form: "TAB",
      strength: "50 мг",
      dose: "1 таб.",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: null,
      durationDays: null,
      instructionRu: "x".repeat(500),
      instructionUz: null,
    });
  });

  it("nothing usable is no schema at all: one spelling for «none»", () => {
    expect(parseDrugArsenalSchema(null)).toBeNull();
    expect(parseDrugArsenalSchema([])).toBeNull();
    expect(parseDrugArsenalSchema("1 таб")).toBeNull();
    expect(parseDrugArsenalSchema({ mealRelation: "NO_MATTER", timesOfDay: [] })).toBeNull();
    expect(isEmptyDrugSchema(null)).toBe(true);
  });

  const schema: DrugArsenalSchema = {
    form: "TAB",
    strength: "150 мг",
    dose: "1 таб.",
    timesOfDay: ["MORNING", "EVENING"],
    mealRelation: "AFTER_MEAL",
    durationDays: 10,
    instructionRu: "Запивать водой",
    instructionUz: null,
  };

  it("a «Мои» click applies it whole, over what he wrote last time", () => {
    const base = shortItemFromDrug(hit("tolperisone", { nameRu: "Толперизон" }), {
      label: "Мидокалм (толперизон)",
      count: 4,
      lastDose: "50 мг",
      lastForm: "AMP",
      lastStrength: "100 мг/мл",
      lastTimesOfDay: ["NIGHT"],
      lastMealRelation: "NO_MATTER",
      lastDurationDays: 5,
    });
    const { draft } = draftFromShortItem({ ...base, arsenalSchema: schema }, "mine");
    expect(draft).toMatchObject({
      drugId: "tolperisone",
      displayName: "Мидокалм (толперизон)",
      form: "TAB",
      strength: "150 мг",
      dose: "1 таб.",
      timesOfDay: ["MORNING", "EVENING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 10,
      instructionRu: "Запивать водой",
    });
    // Without a schema: his last time, exactly as before.
    const learned = draftFromShortItem(base, "mine").draft;
    expect(learned).toMatchObject({ form: "AMP", dose: "50 мг", timesOfDay: ["NIGHT"], durationDays: 5 });
  });

  it("an empty field takes the catalog's default, not an older visit's value", () => {
    const base = shortItemFromDrug(hit("tolperisone"), {
      label: "Толперизон",
      count: 2,
      lastDose: "3 таб.",
      lastForm: "TAB",
      lastStrength: "50 мг",
      lastTimesOfDay: [],
      lastMealRelation: null,
      lastDurationDays: null,
    });
    const onlyTimes = parseDrugArsenalSchema({ timesOfDay: ["NIGHT"], durationDays: 14 })!;
    const { draft } = draftFromShortItem({ ...base, arsenalSchema: onlyTimes }, "mine");
    expect(draft).toMatchObject({ form: "TAB", strength: "50 мг", dose: "50 мг", timesOfDay: ["NIGHT"], durationDays: 14 });
    // A strength alone lands on the form it belongs to.
    const amp = parseDrugArsenalSchema({ strength: "100 мг/мл", dose: "2 мл" })!;
    expect(draftFromShortItem({ ...base, arsenalSchema: amp }, "mine").draft).toMatchObject({
      form: "AMP",
      strength: "100 мг/мл",
      dose: "2 мл",
    });
  });

  it("a pin he never wrote is his by its schema: his label, not the clinic's", () => {
    const pin = { ...shortItemFromDrug(hit("pregabalin"), undefined, { label: "Лирика" }), arsenalSchema: schema };
    expect(shortItemKind(pin)).toBe("mine");
    expect(shortItemKind({ count: 0 })).toBe("clinic");
  });

  it("«Мои» takes the arsenal's order and each drug's schema; «Частые» never carries one", () => {
    const frequent = [shortItemFromDrug(hit("a"), { label: "A", count: 3, lastDose: "1 таб." })];
    const starredFromServer = [
      { ...shortItemFromDrug(hit("b"), undefined, { pinned: true }), label: "B", arsenalSchema: null },
    ];
    const col = starredColumn({
      favorites: ["b", "a"],
      starred: starredFromServer,
      known: frequent,
      seen: new Map(),
      usual: {},
      schemas: new Map([
        ["a", schema],
        ["b", null],
      ]),
    });
    expect(col.map((i) => [i.drugId, i.arsenalSchema ?? null])).toEqual([
      ["b", null],
      ["a", schema],
    ]);
    // The «Частые» item itself is untouched: its learned usual applies there.
    expect(frequent[0]!.arsenalSchema).toBeUndefined();
    expect(draftFromShortItem(frequent[0]!, "mine").draft.dose).toBe("1 таб.");
  });
});

// ── 4. Who may edit ──────────────────────────────────────────────────────

describe("who may edit an arsenal", () => {
  const clinic = "c1";
  const own = { userId: "u_doc", clinicId: clinic };
  it("the doctor his own, never a colleague's", () => {
    expect(canManageArsenal({ role: "DOCTOR", userId: "u_doc", clinicId: clinic }, own)).toBe(true);
    expect(canManageArsenal({ role: "DOCTOR", userId: "u_other", clinicId: clinic }, own)).toBe(false);
    expect(canManageArsenal({ role: "DOCTOR", userId: "u_doc", clinicId: clinic }, { userId: null, clinicId: clinic })).toBe(false);
  });
  it("the clinic's ADMIN any doctor of that clinic; nobody across clinics; no other role", () => {
    expect(canManageArsenal({ role: "ADMIN", userId: "u_admin", clinicId: clinic }, own)).toBe(true);
    expect(canManageArsenal({ role: "SUPER_ADMIN", userId: "u_sa", clinicId: clinic }, own)).toBe(true);
    expect(canManageArsenal({ role: "ADMIN", userId: "u_admin", clinicId: "c2" }, own)).toBe(false);
    for (const role of ["NURSE", "RECEPTIONIST", "CALL_OPERATOR"]) {
      expect(canManageArsenal({ role, userId: "u_doc", clinicId: clinic }, own), role).toBe(false);
    }
  });
});

// ── 5. The migration ─────────────────────────────────────────────────────

describe("the migration is additive and safe on existing rows", () => {
  const dir = readdirSync(path.join(root, "prisma/migrations")).find((n) =>
    n.endsWith("_doctor_arsenal"),
  );
  const sql = dir ? read(`prisma/migrations/${dir}/migration.sql`) : "";
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  it("sits in its slot of the day, after every migration before it", () => {
    expect(dir).toBeDefined();
    const ts = Number(dir!.slice(0, 14));
    expect(ts).toBeGreaterThanOrEqual(20261003300000);
    expect(ts).toBeLessThanOrEqual(20261003399999);
    const all = readdirSync(path.join(root, "prisma/migrations")).filter((n) => /^\d{14}_/.test(n)).sort();
    // WHY not «the latest»: later migrations (e.g. the 05.10 start page) come
    // after it. What matters is that nothing was slipped in before it.
    expect(all[all.indexOf(dir!) - 1]).toBe("20261003100000_dev_tasks");
  });

  it("only adds: nullable or defaulted columns, and indexes", () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const st of statements) {
      expect(st, st).toMatch(/^(ALTER TABLE "\w+" ADD COLUMN|CREATE INDEX)/);
      expect(st, st).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE|ALTER COLUMN|SET NOT NULL|TYPE)\b/);
      // Every NOT NULL column carries a default for the rows already there.
      for (const col of st.split(/,\s*ADD COLUMN/)) {
        if (/NOT NULL/.test(col)) expect(col, col).toMatch(/DEFAULT/);
      }
    }
    expect(sql).toMatch(/"DoctorFavorite" ADD COLUMN\s+"schema" JSONB;/);
    expect(sql).toMatch(/"frequentDrugLimit" INTEGER NOT NULL DEFAULT 20/);
    expect(sql).toMatch(/"frequentDiagnosisLimit" INTEGER NOT NULL DEFAULT 20/);
    expect(sql).toMatch(/CREATE INDEX "VisitNote_clinicId_doctorId_createdAt_idx"/);
  });

  it("the schema says the same, defaults included", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/frequentDrugLimit\s+Int\s+@default\(20\)/);
    expect(schema).toMatch(/frequentDiagnosisLimit\s+Int\s+@default\(20\)/);
    const fav = schema.slice(schema.indexOf("model DoctorFavorite {"));
    expect(fav.slice(0, fav.indexOf("}"))).toMatch(/schema\s+Json\?/);
    const note = schema.slice(schema.indexOf("model VisitNote {"));
    expect(note.slice(0, note.indexOf("\n}"))).toContain("@@index([clinicId, doctorId, createdAt])");
  });
});

// ── 6. On screen ─────────────────────────────────────────────────────────

const messages = {
  ru: JSON.parse(read("src/messages/ru.json")),
  uz: JSON.parse(read("src/messages/uz.json")),
};

function render(el: React.ReactElement, qc: QueryClient, locale: "ru" | "uz" = "ru"): string {
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      // `children` as a prop: the provider's props type requires it, and
      // tsc does not count a third createElement argument towards that.
      // eslint-disable-next-line react/no-children-prop
      React.createElement(NextIntlClientProvider, {
        locale,
        messages: messages[locale],
        timeZone: "Asia/Tashkent",
        now: new Date("2026-10-03T07:00:00.000Z"),
        children: el,
      }),
    ),
  );
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const emptyNote = {
  id: "vn_1",
  patientId: "p_1",
  status: "DRAFT",
  diagnosisCode: null,
  diagnosisName: null,
  additionalDiagnoses: [],
  prescriptions: [],
  visitPrescriptions: [],
  advice: [],
} as unknown as VisitNoteRow;

describe("the diagnosis picker's «Частые»", () => {
  const frequent = Array.from({ length: 14 }, (_, i) => ({
    code: `G${String(40 + i)}.0`,
    name: `Диагноз ${i}`,
    count: 20 - i,
    pinned: false,
  }));

  function dxPicker(over: Partial<DiagnosisShortlist>, locale: "ru" | "uz" = "ru") {
    const qc = client();
    qc.setQueryData(diagnosisShortlistKey, {
      rows: [],
      frequent,
      starred: [],
      frequentSource: "own",
      frequentLimit: 10,
      ...over,
    } satisfies DiagnosisShortlist);
    qc.setQueryData(doctorFavoritesKey("ICD10"), []);
    return render(
      React.createElement(DiagnosisPicker, {
        note: emptyNote,
        liveNote: () => emptyNote,
        onChange: () => undefined,
        trail: [],
        onTrail: () => undefined,
        onCollapse: null,
      }),
      qc,
      locale,
    );
  }

  it("shows his chosen 10 of the 30, the switch on 10, a count on every row", () => {
    const html = dxPicker({});
    expect(html).toContain(">G49.0<");
    expect(html).not.toContain(">G50.0<");
    expect(html).toMatch(/role="radio" aria-checked="true" aria-label="Показывать 10"/);
    expect(html).toMatch(/aria-checked="false" aria-label="Показывать 20"/);
    expect(html).toContain('title="Ставили 20 раз за год"');
    // The first rows are the biggest targets.
    expect(html.match(/min-h-14 py-2/g)).toHaveLength(5);
  });

  it("20 shows the whole list here; a doctor with none sees the clinic's, named so", () => {
    expect(dxPicker({ frequentLimit: 20 })).toContain(">G53.0<");
    const clinic = dxPicker({ frequentSource: "clinic" });
    expect(clinic).toContain("Частые в клинике");
    expect(clinic).toContain('title="В клинике ставили 20 раз за год"');
    expect(dxPicker({ frequentSource: "clinic" }, "uz")).toContain("Klinikada tez-tez");
  });
});

describe("the prescription picker's «Частые» and «Мои»", () => {
  const ownItem = (id: string, count: number): DrugShortItem => ({
    ...shortItemFromDrug(hit(id, { nameRu: id.toUpperCase() }), {
      label: id.toUpperCase(),
      count,
      lastDose: "1 таб.",
    }),
  });

  function rxPicker(over: Partial<DrugShortlist>, favorites: unknown[] = []) {
    const qc = client();
    const core = ["pregabalin", "betahistine", "own2"].map((id) =>
      shortItemFromDrug(hit(id, { nameRu: `Core ${id}` }), undefined, { label: `Core ${id}`, strengths: ["75 мг"] }),
    );
    qc.setQueryData(drugShortlistKey, {
      mine: [],
      clinic: [],
      frequent: [ownItem("own1", 9), ownItem("own2", 4)],
      starred: [],
      core,
      coreRank: ["betahistine", "pregabalin", "own2"],
      usual: {},
      frequentLimit: 10,
      ...over,
    } satisfies DrugShortlist);
    qc.setQueryData(doctorFavoritesKey("DRUG"), favorites);
    return render(
      React.createElement(PrescriptionPicker, {
        noteId: "vn_1",
        diagnosisCode: null,
        rows: [],
        legacy: [],
        presets: [],
        onPresetClick: () => undefined,
        onPickItem: () => undefined,
        onPickHit: () => undefined,
        onAddToClinicBase: () => undefined,
        addingToClinic: false,
      }),
      qc,
    );
  }

  it("his own with their counts, then the core list by clinic use under its heading", () => {
    const html = rxPicker({});
    expect(html).toContain('title="Назначали 9 раз за год"');
    expect(html).toContain("Основные препараты клиники");
    const own2 = html.indexOf(">OWN2<");
    const beta = html.indexOf("Core betahistine");
    const pregab = html.indexOf("Core pregabalin");
    expect(own2).toBeGreaterThan(-1);
    expect(beta).toBeGreaterThan(own2);
    expect(pregab).toBeGreaterThan(beta);
    // His own drug is not repeated from the core list.
    expect(html).not.toContain("Core own2</span>");
    expect(html).toMatch(/aria-checked="true" aria-label="Показывать 10"/);
  });

  it("«Мои» in the arsenal's order, a schema shown as his line", () => {
    const schema = { dose: "2 таб.", timesOfDay: ["MORNING"], mealRelation: "AFTER_MEAL", durationDays: 7 };
    const starred = [
      { ...ownItem("own1", 9), pinned: true },
      { ...ownItem("own2", 4), pinned: true },
    ];
    const html = rxPicker({ starred }, [
      { id: "f2", userId: "u", entityType: "DRUG", entityCode: "own2", sortOrder: 0, createdAt: "2026-10-01", schema },
      { id: "f1", userId: "u", entityType: "DRUG", entityCode: "own1", sortOrder: 1, createdAt: "2026-10-01", schema: null },
    ]);
    const mine = html.slice(html.indexOf(">Мои</h3>"));
    expect(mine.indexOf(">OWN2<")).toBeLessThan(mine.indexOf(">OWN1<"));
    expect(mine).toContain("2 таб., утром, после еды, 7 дн.");
    expect(mine).toContain('title="Ваша схема из «Мой арсенал»"');
  });
});

describe("«Мой арсенал», the page", () => {
  const drugs: DrugArsenal = {
    doctor: { id: "doc_aziz", nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz" },
    kind: "DRUG",
    max: 30,
    frequentLimit: 20,
    items: [
      {
        code: "pregabalin",
        schema: parseDrugArsenalSchema({ dose: "1 капс.", timesOfDay: ["NIGHT"], durationDays: 14 }),
        entry: shortItemFromDrug(hit("pregabalin", { nameRu: "Прегабалин" }), undefined, { label: "Лирика" }),
      },
      { code: "mexidol", schema: null, entry: shortItemFromDrug(hit("mexidol"), undefined, { label: "Мексидол" }) },
      { code: "retired", schema: null, entry: null },
    ],
    top: [shortItemFromDrug(hit("nimesulide"), { label: "Найз", count: 7, lastDose: "100 мг" })],
    core: [shortItemFromDrug(hit("betahistine"), undefined, { label: "Бетасерк", strengths: ["24 мг"] })],
  };

  function page(
    seed: (qc: QueryClient) => void,
    locale: "ru" | "uz" = "ru",
    initialKind: "DRUG" | "ICD10" = "DRUG",
  ) {
    const qc = client();
    seed(qc);
    return render(React.createElement(ArsenalEditor, { initialKind }), qc, locale);
  }

  it("his arsenal in order with positions, schemas and a way out for a retired drug; sources one click away", () => {
    const html = page((qc) => qc.setQueryData(arsenalKey("DRUG", null), drugs));
    expect(html).toContain("3 из 30");
    const lyrica = html.indexOf(">Лирика<");
    const mexidol = html.indexOf(">Мексидол<");
    expect(lyrica).toBeGreaterThan(-1);
    expect(mexidol).toBeGreaterThan(lyrica);
    expect(html).toContain("1 капс., на ночь, 14 дн.");
    expect(html).toContain("Схема не задана: подставится последняя доза");
    expect(html).toContain("Препарат больше недоступен в клинике. Его можно убрать.");
    expect(html.match(/aria-label="Перетащить"/g)).toHaveLength(3);
    expect(html.match(/aria-label="Убрать из арсенала"/g)).toHaveLength(3);
    // Sources: his top with its count, the clinic's core list, search, catalog.
    expect(html).toContain("Частые за год");
    expect(html).toContain('title="Назначали 7 раз за год"');
    expect(html).toContain("Основные препараты клиники");
    expect(html).toContain("Каталог по группам");
    expect(html.match(/>В арсенал</g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>20</);
  });

  it("a full arsenal says so and locks the sources; a card without a login is explained", () => {
    const full = {
      ...drugs,
      items: Array.from({ length: 30 }, (_, i) => ({ code: `d${i}`, schema: null, entry: null })),
    };
    const html = page((qc) => qc.setQueryData(arsenalKey("DRUG", null), full));
    expect(html).toContain("В арсенале уже 30. Уберите что-нибудь слева, чтобы добавить новое.");
    const top = html.slice(html.indexOf("Частые за год"));
    expect(top.slice(0, top.indexOf("</li>"))).toMatch(/<button[^>]*disabled/);
  });

  it("the diagnoses tab and Uzbek render too", () => {
    const dx: DiagnosisArsenal = {
      doctor: drugs.doctor,
      kind: "ICD10",
      max: 30,
      frequentLimit: 10,
      items: [{ code: "G44.2", name: "Головная боль напряжённого типа", count: 43 }],
      top: [{ code: "M54.4", name: "Люмбаго с ишиасом", count: 19, pinned: false }],
      topSource: "own",
    };
    const seed = (qc: QueryClient) => {
      qc.setQueryData(arsenalKey("DRUG", null), drugs);
      qc.setQueryData(arsenalKey("ICD10", null), dx);
    };
    const ru = page(seed, "ru", "ICD10");
    expect(ru).toContain(">G44.2<");
    expect(ru).toContain("1 из 30");
    expect(ru).toContain('title="Ставили 19 раз за год"');
    expect(ru).toContain("Каталог МКБ-10");
    expect(ru).toMatch(/role="radio" aria-checked="true"[^>]*>10</);
    const uz = page(seed, "uz");
    expect(uz).toContain("Dorilar");
    expect(uz).toContain("Tashxislar");
    expect(uz).toContain("30 tadan 3");
  });
});

describe("the words: ru and uz in parity, no dashes", () => {
  const flat = (o: unknown, prefix = ""): Record<string, string> =>
    typeof o === "string"
      ? { [prefix]: o }
      : Object.assign(
          {},
          ...Object.entries(o as Record<string, unknown>).map(([k, v]) =>
            flat(v, prefix ? `${prefix}.${k}` : k),
          ),
        );
  const pick = (loc: "ru" | "uz") => {
    const m = messages[loc];
    return {
      ...flat(m.doctor.arsenal, "doctor.arsenal"),
      ...flat(m.doctor.reception.topSwitch, "topSwitch"),
      "rx.arsenalHint": m.doctor.reception.rx.picker.arsenalHint,
      "dx.clinicFrequent": m.doctor.reception.diagnosis.picker.clinicFrequent,
      "dx.clinicCount": m.doctor.reception.diagnosis.picker.clinicCount,
      "fav.arsenalFull": m.doctor.receptionDialogs.favorites.arsenalFull,
      "nav.arsenal": m.doctor.nav.sidebar.arsenal,
      "crm.tab": m.crmDoctors.tabs.arsenal,
      "crm.hint": m.crmDoctors.arsenalHint,
    } as Record<string, string>;
  };

  it("same keys, every one filled, none with a dash", () => {
    const ru = pick("ru");
    const uz = pick("uz");
    expect(Object.keys(uz).sort()).toEqual(Object.keys(ru).sort());
    for (const [key, text] of [...Object.entries(ru), ...Object.entries(uz)]) {
      expect(text, key).toBeTruthy();
      expect(text, key).not.toMatch(/[—–]/);
    }
    // The placeholders match too.
    for (const key of Object.keys(ru)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(uz[key]!), key).toEqual(vars(ru[key]!));
    }
  });
});

describe("wired where it is used", () => {
  it("the cabinet links the page, the CRM doctor page has the ADMIN tab", () => {
    expect(read("src/app/[locale]/doctor/_components/doctor-sidebar.tsx")).toMatch(
      /href: "arsenal", labelKey: "sidebar\.arsenal"/,
    );
    expect(read("src/app/[locale]/doctor/arsenal/page.tsx")).toContain("<ArsenalEditor />");
    const crm = read("src/app/[locale]/crm/doctors/[id]/_components/doctor-profile-client.tsx");
    expect(crm).toMatch(/isAdmin \? \(\s*<TabsTrigger value="arsenal">/);
    expect(crm).toContain("<ArsenalEditor doctorId={doctor.id} />");
  });
});
