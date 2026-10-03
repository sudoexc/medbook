/**
 * Review fixes for the mouse-first visit screen (03.10.2026).
 *
 *   [0] a drug added from the columns opened its schedule editor, and its
 *       drug check warning appeared, below the fold or under the sticky
 *       «Завершить приём» bar: both are now scrolled into view;
 *   [1] a drug starred in the «Каталог» window stayed out of «Мои» until a
 *       reload: the star now refetches the open picker's shortlist;
 *   [2] «Добавить всё» put one drug on the sheet twice (a catalog row and a
 *       preset's text line): the memory joins them, the batch and the
 *       «on the visit» rule compare a line by the drug it names;
 *   [3] a protocol's conclusion template was written twice on a second
 *       apply and could not be taken out with the editor gone: it is
 *       written once, leaves with its diagnosis, and «Предпросмотр» offers
 *       «Убрать текст шаблона».
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver, MutationObserver } from "@tanstack/react-query";

import {
  drugNameForms,
  lineNamesDrug,
  lineWords,
  wordsNameDrug,
} from "@/lib/catalogs/line-names-drug";
import {
  appendSnippet,
  orphanedProtocolTemplates,
  removeSnippet,
  templatesInBody,
} from "@/lib/conclusion-body";
import { buildDiagnosisMemory, type MemoryNote } from "@/server/catalog/diagnosis-memory";
import { memoryToAdd, adviceChecker } from "@/app/[locale]/doctor/reception/_hooks/diagnosis-columns";
import { onVisitChecker } from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";
import type { DrugShortItem } from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";
import {
  doctorFavoritesKey,
  favoriteToggleOptions,
  nextFavoriteToggle,
} from "@/app/[locale]/doctor/reception/_hooks/use-doctor-favorites";
import {
  departedTemplates,
  goneCodes,
} from "@/app/[locale]/doctor/reception/_hooks/use-templates-follow-diagnoses";
import type { ClinicalProtocolRow } from "@/app/[locale]/doctor/reception/_hooks/use-clinical-protocols";
import { bringsNewWarning } from "@/app/[locale]/doctor/reception/_components/cds-warnings-card";

afterEach(() => {
  vi.unstubAllGlobals();
});

const d = (iso: string) => new Date(iso);

// ── [2] one drug, one entry ─────────────────────────────────────────────

describe("a text line names a drug", () => {
  it("by the drug's name followed by its dose", () => {
    expect(lineNamesDrug("Мексидол 5,0 в/м №10", "Мексидол")).toBe(true);
    expect(lineNamesDrug("Мексидол", "Мексидол")).toBe(true);
    expect(lineNamesDrug("Мильгамма в/м 2,0 №10", "Мильгамма")).toBe(true);
    expect(lineNamesDrug("Мидокалм по 1 таб 3 раза", "Мидокалм (толперизон)")).toBe(true);
    // What the bracket holds is a name too.
    expect(lineNamesDrug("Толперизон 150 мг", "Мидокалм (толперизон)")).toBe(true);
    // The search's fold: ® and a Cyrillic В in «В6».
    expect(lineNamesDrug("Магне® В6 1 таб", "Магне B6")).toBe(true);
    expect(lineNamesDrug("Витамин D3 2000 МЕ", "Витамин D3")).toBe(true);
  });

  it("not when the line goes on with more of a name", () => {
    expect(lineNamesDrug("Магний B6 1 таб", "Магний")).toBe(false);
    expect(lineNamesDrug("Нурофен плюс 1 таб", "Нурофен")).toBe(false);
    expect(lineNamesDrug("Магне B6 форте 1 таб", "Магне B6")).toBe(false);
    expect(lineNamesDrug("Мекс", "Мексидол")).toBe(false);
    expect(lineNamesDrug("Массаж шейно-воротниковой зоны №10", "Мексидол")).toBe(false);
    expect(lineNamesDrug("—", "Мексидол")).toBe(false);
  });

  it("works on words folded once", () => {
    const forms = drugNameForms("Мидокалм (толперизон)");
    expect(forms).toEqual([["мидокалм", "толперизон"], ["мидокалм"], ["толперизон"]]);
    expect(wordsNameDrug(lineWords("мидокалм 150"), forms)).toBe(true);
    expect(drugNameForms("  ")).toEqual([]);
  });
});

function visit(
  id: string,
  at: string,
  over: Partial<Omit<MemoryNote, "id" | "at">> = {},
): MemoryNote {
  return { id, at: d(at), structured: [], freeText: [], advice: [], ...over };
}

const MEXIDOL = (over: Record<string, unknown> = {}) => ({
  drugId: "mexidol",
  displayName: "Мексидол",
  dose: "5 мл",
  form: "INJ",
  strength: "50 мг/мл",
  timesOfDay: ["MORNING"],
  mealRelation: "NO_MATTER",
  durationDays: 10,
  ...over,
});

describe("buildDiagnosisMemory: a drug written as a row and as a line is one drug", () => {
  it("joins the preset's line into the catalog row, with the row's dose", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", { structured: [MEXIDOL()] }),
        visit("v2", "2026-09-05", { freeText: ["Мексидол 5,0 в/м №10"] }),
        visit("v3", "2026-09-10", { structured: [MEXIDOL()] }),
        // Both on one visit: still one visit.
        visit("v4", "2026-09-20", {
          structured: [MEXIDOL()],
          freeText: ["Мексидол 5,0 в/м №10"],
        }),
      ],
    });
    expect(memory.prescriptions).toHaveLength(1);
    expect(memory.prescriptions[0]).toMatchObject({
      key: "mexidol",
      drugId: "mexidol",
      label: "Мексидол",
      count: 4,
      lastDose: "5 мл",
      lastTimesOfDay: ["MORNING"],
      lastDurationDays: 10,
    });
  });

  it("a line counts toward the threshold of the drug it names", () => {
    // Four visits: the threshold is 2, and neither half reaches it alone.
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", { structured: [MEXIDOL()], advice: ["Режим сна"] }),
        visit("v2", "2026-09-02", { freeText: ["Мексидол 5,0 в/м №10"], advice: ["Режим сна"] }),
        visit("v3", "2026-09-03", { advice: ["Режим сна"] }),
        visit("v4", "2026-09-04", { advice: ["Режим сна"] }),
      ],
    });
    expect(memory.prescriptions.map((p) => p.drugId)).toEqual(["mexidol"]);
    expect(memory.prescriptions[0]!.count).toBe(2);
  });

  it("a hand-typed row joins the catalog drug it names, its doses along", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", {
          structured: [{ ...MEXIDOL(), drugId: null, displayName: "Мексидол амп", dose: "2 мл" }],
        }),
        visit("v2", "2026-09-02", {
          structured: [{ ...MEXIDOL(), drugId: null, displayName: "Мексидол амп", dose: "2 мл" }],
        }),
        visit("v3", "2026-09-03", { structured: [MEXIDOL()] }),
      ],
    });
    expect(memory.prescriptions).toHaveLength(1);
    expect(memory.prescriptions[0]).toMatchObject({
      drugId: "mexidol",
      label: "Мексидол",
      count: 3,
      // His most written way, now that the hand-typed rows count too.
      lastDose: "2 мл",
    });
  });

  it("a line joins a hand-typed row when no catalog drug is named", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", {
          structured: [{ drugId: null, displayName: "Кортексин", dose: "10 мг" }],
        }),
        visit("v2", "2026-09-02", { freeText: ["Кортексин 10 мг в/м №10"] }),
      ],
    });
    expect(memory.prescriptions).toHaveLength(1);
    expect(memory.prescriptions[0]).toMatchObject({ drugId: null, label: "Кортексин", count: 2, lastDose: "10 мг" });
  });

  it("keeps apart what only looks alike, and a line alone stays a line", () => {
    const memory = buildDiagnosisMemory({
      notes: [
        visit("v1", "2026-09-01", {
          structured: [{ drugId: "magnesium", displayName: "Магний", dose: "1 таб." }],
          freeText: ["Магний B6 1 таб 2 раза", "Массаж №10"],
        }),
      ],
    });
    expect(memory.prescriptions.map((p) => p.label).sort()).toEqual([
      "Магний",
      "Магний B6 1 таб 2 раза",
      "Массаж №10",
    ]);
    const line = memory.prescriptions.find((p) => p.label === "Массаж №10")!;
    expect(line).toMatchObject({ drugId: null, lastDose: null, lastTimesOfDay: [] });
  });
});

const item = (over: Partial<DrugShortItem> = {}): DrugShortItem => ({
  key: "mexidol",
  drugId: "mexidol",
  label: "Мексидол",
  count: 4,
  lastDose: "5 мл",
  lastForm: "INJ",
  lastStrength: "50 мг/мл",
  lastTimesOfDay: ["MORNING"],
  lastMealRelation: "NO_MATTER",
  lastDurationDays: 10,
  pinned: false,
  strengths: [],
  drug: null,
  ...over,
});

const LINE = item({
  key: "text:мексидол 5 0 в м 10",
  drugId: null,
  label: "Мексидол 5,0 в/м №10",
  lastDose: null,
  lastForm: null,
  lastStrength: null,
  lastTimesOfDay: [],
  lastMealRelation: null,
  lastDurationDays: null,
});

describe("«Добавить всё» adds each drug once", () => {
  const nothingOnVisit = onVisitChecker([], []);
  const noAdvice = adviceChecker([]);

  it("the catalog row stays and its line goes, whatever their order", () => {
    for (const prescriptions of [
      [item(), LINE],
      [LINE, item()],
    ]) {
      const todo = memoryToAdd({ prescriptions, advice: [] }, nothingOnVisit, noAdvice);
      expect(todo.items.map((i) => i.key)).toEqual(["mexidol"]);
    }
  });

  it("other drugs keep the memory's order", () => {
    const sumatriptan = item({ key: "sumatriptan", drugId: "sumatriptan", label: "Суматриптан" });
    const massage = item({ ...LINE, key: "text:массаж", label: "Массаж №10" });
    const todo = memoryToAdd(
      { prescriptions: [LINE, sumatriptan, item(), massage], advice: [] },
      nothingOnVisit,
      noAdvice,
    );
    expect(todo.items.map((i) => i.key)).toEqual(["sumatriptan", "mexidol", "text:массаж"]);
  });

  it("a line is on the visit once a row of its drug is, and the other way round", () => {
    const withRow = onVisitChecker([{ drugId: "mexidol", displayName: "Мексидол" }], []);
    expect(withRow(LINE)).toBe(true);
    expect(memoryToAdd({ prescriptions: [LINE], advice: [] }, withRow, noAdvice).items).toEqual([]);

    const withLine = onVisitChecker([], ["Мексидол 5,0 в/м №10"]);
    expect(withLine(item())).toBe(true);
    expect(withLine({ drugId: "midocalm", label: "Мидокалм (толперизон)" })).toBe(false);

    // A longer name is another drug: it stays one click away.
    const nurofen = onVisitChecker([{ drugId: "nurofen", displayName: "Нурофен" }], []);
    expect(nurofen({ drugId: null, label: "Нурофен плюс" })).toBe(false);
    expect(nurofen({ drugId: null, label: "Нурофен 200 мг" })).toBe(true);
  });
});

// ── [1] a star from the «Каталог» window reaches «Мои» ─────────────────

describe("a star settles into the picker's shortlist", () => {
  function stubFetch() {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("doctor-favorites") && (init?.method ?? "GET") === "GET") {
          return Response.json({ favorites: [] });
        }
        return new Response(null, { status: 200 });
      }),
    );
    return calls;
  }

  it("a drug star refetches the open picker's shortlist once it is saved", async () => {
    const calls = stubFetch();
    const qc = new QueryClient();
    qc.setQueryData(doctorFavoritesKey("DRUG"), []);
    const shortlistFn = vi.fn(async () => ({ starred: [] }));
    const rxKey = ["doctor", "reception", "rx-shortlist"] as const;
    // The picker is mounted with a fresh list (staleTime 5 min).
    const picker = new QueryObserver(qc, { queryKey: rxKey, queryFn: shortlistFn, staleTime: 300_000 });
    const unsubscribe = picker.subscribe(() => undefined);
    await vi.waitFor(() => expect(shortlistFn).toHaveBeenCalledTimes(1));

    await new MutationObserver(qc, favoriteToggleOptions(qc, "DRUG")).mutate(
      nextFavoriteToggle(qc, "DRUG", "tolperisone"),
    );
    expect(calls).toContain("POST /api/crm/doctor-favorites");
    await vi.waitFor(() => expect(shortlistFn).toHaveBeenCalledTimes(2));
    unsubscribe();
  });

  it("a diagnosis star only marks the field's list stale, never under the cursor", async () => {
    stubFetch();
    const qc = new QueryClient();
    qc.setQueryData(doctorFavoritesKey("ICD10"), []);
    const shortlistFn = vi.fn(async () => ({ rows: [] }));
    const dxKey = ["doctor", "reception", "dx-shortlist"] as const;
    const field = new QueryObserver(qc, { queryKey: dxKey, queryFn: shortlistFn, staleTime: 300_000 });
    const unsubscribe = field.subscribe(() => undefined);
    await vi.waitFor(() => expect(shortlistFn).toHaveBeenCalledTimes(1));

    await new MutationObserver(qc, favoriteToggleOptions(qc, "ICD10")).mutate(
      nextFavoriteToggle(qc, "ICD10", "G43.0"),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(shortlistFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryState(dxKey)?.isInvalidated).toBe(true);
    unsubscribe();
  });
});

// ── [3] the template text without an editor ─────────────────────────────

const MIGRAINE = "Мигрень без ауры. Рекомендован дневник головной боли.";

describe("a template is written once and can go again", () => {
  it("applying a protocol twice writes its template once", () => {
    const once = appendSnippet("Осмотр.", MIGRAINE);
    expect(once).toBe(`Осмотр.\n\n${MIGRAINE}`);
    expect(appendSnippet(once, `  ${MIGRAINE}\n`)).toBe(once);
    expect(appendSnippet("", MIGRAINE)).toBe(MIGRAINE);
  });

  it("a template stored with spaces around it is found again", () => {
    const body = appendSnippet("Осмотр.", `\n${MIGRAINE}\n`);
    expect(removeSnippet(body, `\n${MIGRAINE}\n`)).toBe("Осмотр.");
  });

  it("the preview names the templates the text holds, each once", () => {
    const body = `Осмотр.\n\n${MIGRAINE}\n\nПресет: шейный отдел.`;
    expect(
      templatesInBody(body, [
        { name: "Мигрень", text: ` ${MIGRAINE} ` },
        { name: "Мигрень (личный)", text: MIGRAINE },
        { name: "Шея", text: "Пресет: шейный отдел." },
        { name: "Пусто", text: "  " },
        { name: "Нет в тексте", text: "Люмбаго." },
      ]),
    ).toEqual([
      { name: "Мигрень", text: MIGRAINE },
      { name: "Шея", text: "Пресет: шейный отдел." },
    ]);
  });

  it("a removed diagnosis takes its protocol's template, unless the visit still calls for it", () => {
    const protocols = [
      { diagnosisCodePrefix: "G43", conclusionTemplateMd: MIGRAINE, name: "Мигрень" },
      { diagnosisCodePrefix: "G43.0", conclusionTemplateMd: null, name: "Без шаблона" },
    ];
    expect(orphanedProtocolTemplates({ codes: ["I10"], protocols })).toEqual([
      { name: "Мигрень", text: MIGRAINE },
    ]);
    // G43.1 is still on the visit: the G43 protocol answers it too.
    expect(orphanedProtocolTemplates({ codes: ["I10", "g43.1"], protocols })).toEqual([]);
  });

  const protocol = (over: Partial<ClinicalProtocolRow>): ClinicalProtocolRow => ({
    id: "p1",
    clinicId: "c1",
    doctorId: null,
    diagnosisCodePrefix: "G43",
    nameRu: "Мигрень",
    nameUz: "Migren",
    summaryRu: null,
    complaintsTemplate: [],
    anamnesisTemplate: [],
    examinationTemplate: [],
    prescriptionsTemplate: [],
    prescriptionItems: null,
    adviceTemplate: [],
    recommendedLabs: [],
    conclusionTemplateMd: MIGRAINE,
    guideCode: null,
    followUpDays: null,
    sortOrder: 0,
    active: true,
    ...over,
  });

  it("only a code that left counts, read once its protocols are in", async () => {
    expect(goneCodes(["G43.0", "I10"], ["I10"])).toEqual(["G43.0"]);
    // Another main diagnosis keeps the old one on the visit: nothing left.
    expect(goneCodes(["G43.0"], ["G44.2", "G43.0"])).toEqual([]);

    const load = vi.fn(async (code: string) =>
      code === "G43.0" ? [protocol({})] : Promise.reject(new Error("offline")),
    );
    expect(
      await departedTemplates({ gone: ["G43.0", "M54.5"], load, codesNow: () => ["I10"], locale: "uz" }),
    ).toEqual([{ name: "Migren", text: MIGRAINE }]);
    // Put back while the protocols loaded: the text stays.
    expect(
      await departedTemplates({ gone: ["G43.0"], load, codesNow: () => ["G43.0"], locale: "ru" }),
    ).toEqual([]);
  });
});

// ── [0] what a click adds is seen ───────────────────────────────────────

describe("a new drug check warning is brought into view", () => {
  const shown = (noteId: string | null, keys: string[]) => ({ noteId, keys: new Set(keys) });
  const none = () => false;

  it("only a warning new since the last answer for this visit", () => {
    expect(bringsNewWarning(shown("n1", []), shown("n1", ["ALLERGY:ibuprofen"]), none)).toBe(true);
    expect(bringsNewWarning(shown("n1", ["a"]), shown("n1", ["a"]), none)).toBe(false);
    expect(bringsNewWarning(shown("n1", ["a", "b"]), shown("n1", ["a"]), none)).toBe(false);
  });

  it("not what the visit held when it opened, nor an acknowledged one", () => {
    expect(bringsNewWarning(null, shown("n1", ["a"]), none)).toBe(false);
    expect(bringsNewWarning(shown("n0", []), shown("n1", ["a"]), none)).toBe(false);
    expect(bringsNewWarning(shown("n1", []), shown("n1", ["a"]), (k) => k === "a")).toBe(false);
  });
});

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor/reception", rel), "utf8");

describe("the wiring", () => {
  it("the row a pick opens is scrolled clear of the sticky bar", () => {
    const rx = read("_components/prescription-constructor.tsx");
    expect(rx).toContain("setRevealRow(opened)");
    expect(rx).toContain("reveal={revealRow === i && expanded === i}");
    expect(rx).toContain("useRevealOnOpen<HTMLLIElement>(reveal)");
    expect(rx).toMatch(/"scroll-mb-28 rounded-lg border bg-card"/);
  });

  it("the warnings card reveals itself on a new warning", () => {
    const cds = read("_components/cds-warnings-card.tsx");
    expect(cds).toContain('ref={revealRef} className="flex scroll-mb-28 flex-col gap-1.5"');
    expect(cds).toContain("bringsNewWarning(");
  });

  it("a diagnosis leaving takes its template; the preview offers to take one out", () => {
    const panel = read("_components/structured-fields-panel.tsx");
    expect(panel).toContain("useTemplatesFollowDiagnoses({");
    expect(panel).toContain("removeTexts: requestBodyRemove");
    const preview = read("_components/conclusion-preview-dialog.tsx");
    expect(preview).toContain("<TemplatesInText");
    expect(preview).toContain("requestBodyRemove(tpl.text)");
    // The channel that writes it lives on the visit tab only.
    expect(preview).toContain('activeTab === "session"');
  });
});

describe("the new words", () => {
  const messages = (loc: string) =>
    JSON.parse(readFileSync(path.join(process.cwd(), `src/messages/${loc}.json`), "utf8")) as {
      doctor: { reception: Record<string, Record<string, string>> };
    };

  it("are in ru and uz, with no dashes", () => {
    for (const loc of ["ru", "uz"]) {
      const r = messages(loc).doctor.reception;
      const words = [
        r.actionBar!.templateInText,
        r.actionBar!.removeTemplateText,
        r.structured!.templateTextRemoved,
      ];
      for (const w of words) {
        expect(typeof w).toBe("string");
        expect(w).not.toMatch(/[—–]/);
      }
      expect(r.actionBar!.templateInText).toContain("{name}");
      expect(r.structured!.templateTextRemoved).toContain("{name}");
    }
  });
});
