/**
 * A6 batch (audit CT-14, CT-15, CT-16, CT-19, G4-16, G4-17, G4-19, G4-21,
 * G4-22): the drug reference and the drug check, low-severity findings.
 *
 *  - CT-14: a failed favourites request is an error (the cached stars stay,
 *    a failed star rolls back), and two quick clicks reach the server in
 *    click order.
 *  - CT-15: no «uzr:» handle as an INN, the pregnancy badge says «нет
 *    данных» instead of «UNKNOWN», A10 is endocrine and M03 neurological.
 *  - CT-16: «М54.5 Люмбаго» typed on the Russian layout offers code + name.
 *  - CT-19: «Без фото» drops what the clinic photographed; the counts read
 *    the rows the list pages through.
 *  - G4-16: a risk diagnosis raises the pair one step (NSAID + ACE inhibitor
 *    with CKD is MAJOR).
 *  - G4-17: a drug matching an allergy is at least MAJOR, an anaphylaxis
 *    makes it CONTRAINDICATED.
 *  - G4-19: the allergy buttons offer Russian names, never handles.
 *  - G4-21: no brand on two seeded rows; the merge plan.
 *  - G4-22: a gel or eye drops are checked as local forms.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import registry from "../../prisma/uzpharm-registry.json";
import { DRUGS } from "../../prisma/_drug-catalog";
import { DRUGS_EXTRA } from "../../prisma/_drug-catalog-extra";
import {
  DUPLICATE_DRUGS,
  MISFILED_BRANDS,
  mergeFormularyAliases,
  planBrandMerge,
  repointDrafts,
} from "../../scripts/_drug-duplicates";
import {
  correctRegisterEntities,
  normName,
  registerCategory,
  type RegistryEntity,
} from "../../scripts/_registry-plan";

import { NOW, cdsState, resetCdsState } from "./cds-fixture";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
  useLocale: () => "ru",
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  hidden: new Set<string>(),
  overrides: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/prisma", async () => {
  const { makeCdsPrisma } = await import("./cds-fixture");
  const cds = makeCdsPrisma();
  type Where = Record<string, unknown>;
  const fieldOk = (val: unknown, f: Record<string, unknown>): boolean => {
    if ("in" in f) return (f.in as unknown[]).includes(val);
    if ("notIn" in f) return !(f.notIn as unknown[]).includes(val);
    if ("not" in f) {
      return f.not === null || typeof f.not === "object"
        ? val !== null && val !== undefined
        : val !== f.not;
    }
    throw new Error(`fake prisma: ${JSON.stringify(f)}`);
  };
  const matches = (row: Record<string, unknown>, where: Where): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (k === "AND") return (v as Where[]).every((w) => matches(row, w));
      if (k === "OR") return (v as Where[]).some((w) => matches(row, w));
      const val = row[k];
      if (v === null) return val === null || val === undefined;
      if (typeof v !== "object") return val === v;
      return fieldOk(val, v as Record<string, unknown>);
    });
  const catalog = (args: { where?: Where }) =>
    db.rows.filter((r) => matches(r, args.where ?? {}));
  return {
    prisma: {
      ...cds,
      drug: {
        // The CDS engine's reads (with `select`) go to the CDS fixture; the
        // catalog routes' reads go to `db.rows`.
        findMany: vi.fn(async (args: { where?: Where; select?: unknown; include?: unknown; skip?: number; take?: number }) => {
          if (db.rows.length === 0) return cds.drug.findMany(args as never);
          const out = catalog(args);
          const skip = args.skip ?? 0;
          return out.slice(skip, args.take !== undefined ? skip + args.take : undefined);
        }),
        count: vi.fn(async (args: { where?: Where }) => catalog(args).length),
      },
    },
  };
});

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "DOCTOR" },
      }),
}));

vi.mock("@/server/catalog/clinic-overlay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog/clinic-overlay")>()),
  loadClinicOverlays: vi.fn(async () => ({ hidden: db.hidden, overrides: db.overrides })),
}));

vi.mock("@/server/catalog/formulary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/catalog/formulary")>()),
  loadFormulary: vi.fn(async () => []),
  searchFormulary: vi.fn(async () => []),
}));

import {
  doctorFavoritesKey,
  favoriteToggleOptions,
  fetchFavorites,
  nextFavoriteToggle,
  type DoctorFavoriteRow,
} from "@/app/[locale]/doctor/reception/_hooks/use-doctor-favorites";
import { PregnancyBadge } from "@/app/[locale]/doctor/_components/drug-detail";
import { allergySuggestionNames, readableInn } from "@/lib/catalogs/drug-names";
import { isLocalForm, localFormLabelRu } from "@/lib/catalogs/drug-forms";
import { parseCodeNameQuery } from "@/lib/icd10-query";
import { isSevereReaction } from "@/server/cds/allergy-match";
import {
  allergyWarningSeverity,
  raiseForRisk,
  runDrugCheck,
  type PinnedDrugRow,
} from "@/server/cds/drug-check";
import { GET as listDrugs } from "@/app/api/crm/catalogs/drugs/route";
import { GET as drugFacets } from "@/app/api/crm/catalogs/drugs/facets/route";

beforeEach(() => {
  resetCdsState();
  db.rows = [];
  db.hidden = new Set();
  db.overrides = new Map();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── CT-14 ────────────────────────────────────────────────────────────────

function favorite(code: string): DoctorFavoriteRow {
  return {
    id: `f-${code}`,
    userId: "u1",
    entityType: "DRUG",
    entityCode: code,
    sortOrder: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

const codes = (qc: QueryClient) =>
  (qc.getQueryData<DoctorFavoriteRow[]>(doctorFavoritesKey("DRUG")) ?? []).map(
    (f) => f.entityCode,
  );

describe("CT-14: favourites fail loudly and in order", () => {
  it("a 500 on the list is thrown, not read as «no favourites»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(fetchFavorites("DRUG")).rejects.toThrow(/500/);
  });

  it("a failed refetch keeps the cached stars", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(doctorFavoritesKey("DRUG"), [favorite("bisoprolol")]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await qc
      .fetchQuery({ queryKey: doctorFavoritesKey("DRUG"), queryFn: () => fetchFavorites("DRUG") })
      .catch(() => undefined);
    expect(codes(qc)).toEqual(["bisoprolol"]);
  });

  it("a 500 on POST rolls the star back", async () => {
    const qc = new QueryClient();
    qc.setQueryData(doctorFavoritesKey("DRUG"), [favorite("bisoprolol")]);
    let answer: () => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise<void>((r) => {
          answer = r;
        });
        return new Response("boom", { status: 500 });
      }),
    );
    const failed = vi.fn();
    const obs = new MutationObserver(qc, favoriteToggleOptions(qc, "DRUG", failed));
    const click = obs.mutate(nextFavoriteToggle(qc, "DRUG", "ibuprofen"));
    await new Promise((r) => setTimeout(r, 0));
    // Optimistic at once…
    expect(codes(qc)).toEqual(["bisoprolol", "ibuprofen"]);
    answer();
    await click.catch(() => undefined);
    // …and undone when the server refuses.
    expect(codes(qc)).toEqual(["bisoprolol"]);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("a quick double click sends POST then DELETE, the second after the first", async () => {
    const qc = new QueryClient();
    qc.setQueryData(doctorFavoritesKey("DRUG"), []);
    const calls: string[] = [];
    let releasePost: () => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push(`${method} start`);
        if (method === "POST") {
          await new Promise<void>((r) => {
            releasePost = r;
          });
        }
        calls.push(`${method} end`);
        return method === "GET"
          ? Response.json({ favorites: [] })
          : new Response(null, { status: 200 });
      }),
    );
    const opts = favoriteToggleOptions(qc, "DRUG");
    const first = new MutationObserver(qc, opts).mutate(
      nextFavoriteToggle(qc, "DRUG", "ibuprofen"),
    );
    await new Promise((r) => setTimeout(r, 0));
    // The second click reads the optimistic star: it unpins.
    const toggle2 = nextFavoriteToggle(qc, "DRUG", "ibuprofen");
    expect(toggle2.pin).toBe(false);
    const second = new MutationObserver(qc, opts).mutate(toggle2);
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual([]);
    releasePost();
    await Promise.all([first, second]);
    const writes = calls.filter((c) => !c.startsWith("GET"));
    expect(writes).toEqual(["POST start", "POST end", "DELETE start", "DELETE end"]);
    expect(codes(qc)).not.toContain("ibuprofen");
  });
});

// ── CT-15 ────────────────────────────────────────────────────────────────

describe("CT-15: no technical handles, a localized pregnancy badge, right categories", () => {
  it("a register, clinic or slug handle is never shown as an INN", () => {
    expect(readableInn({ id: "uzr-glyukozamin", inn: "uzr:glyukozamin", nameRu: "Глюкозамин" })).toBeNull();
    expect(readableInn({ id: "clinic-x", inn: "clinic:c1:кеторол", nameRu: "Кеторол" })).toBeNull();
    expect(readableInn({ id: "aspirin_cardio", inn: "aspirin_cardio", nameRu: "Ацетилсалициловая кислота кардио" })).toBeNull();
    expect(readableInn({ id: "smecta", inn: "smecta", nameRu: "Смектит диоктаэдрический" })).toBeNull();
    expect(readableInn({ id: "carbamazepine", inn: "Carbamazepine", nameRu: "Карбамазепин" })).toBe("Carbamazepine");
  });

  it("the pregnancy badge says «нет данных» for UNKNOWN, and a list row hides it", () => {
    const unknown = renderToStaticMarkup(React.createElement(PregnancyBadge, { cat: "UNKNOWN" }));
    expect(unknown).toContain("doctor.receptionDialogs.catalog.pregnancyUnknown");
    expect(unknown).not.toContain("UNKNOWN");
    expect(
      renderToStaticMarkup(React.createElement(PregnancyBadge, { cat: "UNKNOWN", hideUnknown: true })),
    ).toBe("");
    expect(renderToStaticMarkup(React.createElement(PregnancyBadge, { cat: "D" }))).toContain(">D<");
  });

  it("the payload's A10 rows are endocrine and its M03 rows neurological", () => {
    const raw = (registry as unknown as { entities: RegistryEntity[] }).entities;
    const fixed = correctRegisterEntities(raw);
    const a10 = fixed.filter((e) => e.atcCode?.toUpperCase().startsWith("A10"));
    const m03 = fixed.filter((e) => e.atcCode?.toUpperCase().startsWith("M03"));
    expect(a10.length).toBe(32);
    expect(m03.length).toBe(16);
    expect(new Set(a10.map((e) => e.category))).toEqual(new Set(["ENDOCRINE"]));
    expect(new Set(m03.map((e) => e.category))).toEqual(new Set(["NEUROLOGICAL"]));
    expect(fixed.find((e) => e.id === "uzr-insulin-aspart")?.category).toBe("ENDOCRINE");
    // Nothing else moves, and the payload itself is left as it is.
    expect(registerCategory("A02BC01", "GI")).toBe("GI");
    expect(raw.find((e) => e.id === "uzr-metformin")?.category).toBe("GI");
  });
});

// ── CT-16 ────────────────────────────────────────────────────────────────

describe("CT-16: a code typed on the Russian layout", () => {
  it("«М54.5 Люмбаго» (Cyrillic М) offers the Latin code with the name as typed", () => {
    expect(parseCodeNameQuery("М54.5 Люмбаго")).toEqual({ code: "M54.5", name: "Люмбаго" });
    expect(parseCodeNameQuery("м54.5 люмбаго")).toEqual({ code: "M54.5", name: "люмбаго" });
    expect(parseCodeNameQuery("Е11.9 Сахарный диабет")?.code).toBe("E11.9");
  });

  it("what worked keeps working, what is not a code stays out", () => {
    expect(parseCodeNameQuery("G43.81 Мигрень с осложнением")).toEqual({
      code: "G43.81",
      name: "Мигрень с осложнением",
    });
    expect(parseCodeNameQuery("Мигрень без ауры")).toBeNull();
    expect(parseCodeNameQuery("П43 мигрень")).toBeNull();
    expect(parseCodeNameQuery("M54.5")).toBeNull();
  });
});

// ── CT-19 ────────────────────────────────────────────────────────────────

function catalogRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    inn: id,
    nameRu: id,
    nameUz: null,
    atcCode: null,
    category: "OTHER",
    forms: [],
    indications: [],
    contraindications: [],
    sideEffects: [],
    pregnancyCat: "UNKNOWN",
    defaultDosing: null,
    rxOnly: true,
    active: true,
    photoUrl: null,
    clinicId: null,
    brands: [],
    ...over,
  };
}

describe("CT-19: the photo worklist shrinks and the counts match the list", () => {
  beforeEach(() => {
    db.rows = [
      catalogRow("a-done-globally", { atcCode: "N02BE01", photoUrl: "/files/p/1.jpg" }),
      catalogRow("b-done-by-clinic", { atcCode: "N03AF01" }),
      catalogRow("c-todo", { atcCode: "C07AB07", defaultDosing: { adult: "5 мг" } }),
      catalogRow("d-hidden", { atcCode: "N05BA01" }),
      catalogRow("e-retired", { atcCode: "N06AB06", active: false }),
      catalogRow("f-other-clinic", { atcCode: "A02BC01", clinicId: "c2" }),
      catalogRow("g-own", { clinicId: "c1" }),
    ];
    db.hidden = new Set(["d-hidden"]);
    db.overrides = new Map([["b-done-by-clinic", { photoUrl: "/files/p/2.jpg" }]]);
  });

  it("«Без фото» leaves out a global drug the clinic photographed", async () => {
    const res = await listDrugs(new Request("http://x/api/crm/catalogs/drugs?noPhoto=true"));
    const body = (await res.json()) as { rows: { id: string }[]; total: number };
    expect(body.rows.map((r) => r.id).sort()).toEqual(["c-todo", "g-own"]);
    expect(body.total).toBe(2);
  });

  it("the counts read the visible active rows, and say how many photos are missing", async () => {
    const res = await drugFacets(new Request("http://x/api/crm/catalogs/drugs/facets"));
    const f = (await res.json()) as Record<string, unknown>;
    const all = await listDrugs(new Request("http://x/api/crm/catalogs/drugs"));
    const listed = ((await all.json()) as { total: number }).total;
    expect(f.total).toBe(4);
    expect(f.total).toBe(listed);
    expect(f.byGroup).toEqual({ N: 2, C: 1 });
    expect(f.withoutAtc).toBe(1);
    expect(f.dosingCount).toBe(1);
    expect(f.noPhotoCount).toBe(2);
    expect(f).not.toHaveProperty("photoCount");
  });
});

// ── G4-16 / G4-17 / G4-22: the engine ────────────────────────────────────

async function check(
  rows: PinnedDrugRow[],
  opts: { diagnosisCode?: string | null } = {},
) {
  return runDrugCheck({
    clinicId: "c1",
    patientId: "p1",
    prescriptionLines: [],
    drugRows: rows,
    diagnosisCode: opts.diagnosisCode ?? null,
    now: NOW,
  });
}

describe("G4-16: a risk diagnosis raises the pair", () => {
  it("one step, capped at MAJOR", () => {
    expect(raiseForRisk("MINOR")).toBe("MODERATE");
    expect(raiseForRisk("MODERATE")).toBe("MAJOR");
    expect(raiseForRisk("MAJOR")).toBe("MAJOR");
    expect(raiseForRisk("CONTRAINDICATED")).toBe("CONTRAINDICATED");
  });

  it("enalapril + ibuprofen is MODERATE without kidney disease, MAJOR with N18", async () => {
    const plain = await check([{ id: "enalapril" }, { id: "ibuprofen" }]);
    const pair = plain.warnings.find((w) => w.kind === "INTERACTION");
    expect(pair?.severity).toBe("MODERATE");

    const ckd = await check([{ id: "enalapril" }, { id: "ibuprofen" }], { diagnosisCode: "N18.3" });
    const risk = ckd.warnings.find((w) => w.title.startsWith("Риск при N18.3"));
    expect(risk?.kind).toBe("DIAGNOSIS_RISK");
    expect(risk?.severity).toBe("MAJOR");
  });

  it("heart failure on the card counts too", async () => {
    cdsState.diagnoses = [{ icd10Code: "I50.0", label: "ХСН" }];
    const r = await check([{ id: "enalapril" }, { id: "ibuprofen" }]);
    expect(r.warnings.find((w) => w.kind === "DIAGNOSIS_RISK")?.severity).toBe("MAJOR");
  });
});

describe("G4-17: allergy severity", () => {
  const allergy = (severity: string, reaction: string | null, substance = "Цефтриаксон") => {
    cdsState.allergies = [{ id: "a1", substance, severity, reaction }];
  };
  const allergyWarning = async (id: string) =>
    (await check([{ id }])).warnings.find((w) => w.kind === "ALLERGY");

  it("the drug itself under the default «Лёгкая» is MAJOR, not a yellow «Не назначать»", async () => {
    allergy("MILD", "сыпь");
    const w = await allergyWarning("ceftriaxone");
    expect(w?.severity).toBe("MAJOR");
    expect(w?.detail).toContain("Не назначать");
  });

  it("an anaphylaxis makes it CONTRAINDICATED whatever severity was picked", async () => {
    allergy("MILD", "анафилактический шок");
    expect((await allergyWarning("ceftriaxone"))?.severity).toBe("CONTRAINDICATED");
    allergy("MILD", null, "Цефтриаксон (отёк Квинке)");
    expect((await allergyWarning("ceftriaxone"))?.severity).toBe("CONTRAINDICATED");
  });

  it("a member of a cross-reactive class is MAJOR too, «Тяжёлая» stays CONTRAINDICATED", async () => {
    allergy("MILD", "крапивница", "Амоксициллин");
    const w = await allergyWarning("amoxiclav");
    expect(w?.severity).toBe("MAJOR");
    expect(w?.detail).toContain("Не назначать");
    allergy("SEVERE", "крапивница", "Амоксициллин");
    expect((await allergyWarning("amoxiclav"))?.severity).toBe("CONTRAINDICATED");
    expect(
      allergyWarningSeverity({ severity: "MODERATE", reaction: null, substance: "НПВС" }),
    ).toBe("MAJOR");
  });

  it("severe words are whole words: «шоколад» is no shock", () => {
    expect(isSevereReaction("анафилаксия")).toBe(true);
    expect(isSevereReaction("ССД")).toBe(true);
    expect(isSevereReaction("синдром Стивенса-Джонсона")).toBe(true);
    expect(isSevereReaction("anafilaktik shok")).toBe(true);
    expect(isSevereReaction("шоколад")).toBe(false);
    expect(isSevereReaction("крапивница", null)).toBe(false);
  });
});

describe("G4-22: local forms are not checked as tablets", () => {
  const majors = (r: Awaited<ReturnType<typeof check>>) =>
    r.warnings.filter((w) => w.severity === "MAJOR" || w.severity === "CONTRAINDICATED");

  it("the local forms, named in Russian", () => {
    for (const f of ["DROPS_EYE", "DROPS_EAR", "DROPS_NASAL", "GEL", "CREAM", "OINT"]) {
      expect(isLocalForm(f), f).toBe(true);
    }
    for (const f of ["TAB", "SPRAY", "PATCH", "SUPP_RECT", "INHAL", "INJ_IM", null, "constructor"]) {
      expect(isLocalForm(f), String(f)).toBe(false);
    }
    expect(localFormLabelRu("GEL")).toBe("гель");
  });

  it("ibuprofen tablets + diclofenac gel: no MAJOR, a MINOR that says why", async () => {
    const r = await check([
      { id: "ibuprofen", displayName: "Ибупрофен", form: "TAB" },
      { id: "diclofenac", displayName: "Диклофенак", form: "GEL" },
    ]);
    expect(majors(r)).toEqual([]);
    const pair = r.warnings.find((w) => w.drugB && [w.drugA.id, w.drugB.id].includes("diclofenac"));
    expect(pair?.severity).toBe("MINOR");
    expect(pair?.detail).toContain("Диклофенак: гель");
  });

  it("ibuprofen tablets + diclofenac tablets stay MAJOR", async () => {
    const r = await check([
      { id: "ibuprofen", displayName: "Ибупрофен", form: "TAB" },
      { id: "diclofenac", displayName: "Диклофенак", form: "TAB" },
    ]);
    expect(majors(r).length).toBeGreaterThan(0);
  });

  it("ciprofloxacin eye drops + azithromycin: no QT MAJOR", async () => {
    const r = await check([
      { id: "ciprofloxacin", displayName: "Ципрофлоксацин", form: "DROPS_EYE" },
      { id: "azithromycin", displayName: "Азитромицин", form: "TAB" },
    ]);
    expect(majors(r)).toEqual([]);
    const both = await check([
      { id: "ciprofloxacin", displayName: "Ципрофлоксацин", form: "TAB" },
      { id: "azithromycin", displayName: "Азитромицин", form: "TAB" },
    ]);
    expect(majors(both).length).toBeGreaterThan(0);
  });

  it("a drug also prescribed systemically counts as systemic", async () => {
    const r = await check([
      { id: "ibuprofen", displayName: "Ибупрофен", form: "TAB" },
      { id: "diclofenac", displayName: "Диклофенак", form: "GEL" },
      { id: "diclofenac", displayName: "Диклофенак", form: "TAB" },
    ]);
    expect(majors(r).length).toBeGreaterThan(0);
  });

  it("a gel under a brand next to the same drug's tablets is no double dose", async () => {
    const r = await check([
      { id: "diclofenac", displayName: "Диклофенак", form: "TAB" },
      { id: "diclofenac", displayName: "Вольтарен (диклофенак)", form: "GEL" },
    ]);
    const twice = r.warnings.find((w) => w.title.startsWith("Одно вещество дважды"));
    expect(twice?.severity).toBe("MINOR");
    const tablets = await check([
      { id: "diclofenac", displayName: "Диклофенак", form: "TAB" },
      { id: "diclofenac", displayName: "Вольтарен (диклофенак)", form: "TAB" },
    ]);
    expect(
      tablets.warnings.find((w) => w.title.startsWith("Одно вещество дважды"))?.severity,
    ).toBe("MAJOR");
  });

  it("an allergy still counts for a local form", async () => {
    cdsState.allergies = [{ id: "a1", substance: "Диклофенак", severity: "MILD", reaction: null }];
    const r = await check([{ id: "diclofenac", displayName: "Диклофенак", form: "GEL" }]);
    expect(r.warnings.find((w) => w.kind === "ALLERGY")?.severity).toBe("MAJOR");
  });
});

// ── G4-19 ────────────────────────────────────────────────────────────────

describe("G4-19: allergy buttons offer Russian names", () => {
  it("the recognised drugs' Russian names, each once, never their handles", async () => {
    cdsState.register = [
      {
        id: "uzr-karbaleks",
        inn: "uzr:karbaleks",
        nameRu: "Карбалекс",
        atcCode: null,
        pregnancyCat: "UNKNOWN",
        contraindications: [],
        brands: [],
      },
    ];
    const r = await check([
      { id: "aspirin_cardio" },
      { id: "iron_sorbifer" },
      { id: "uzr-karbaleks" },
      { id: "carbamazepine" },
    ]);
    const names = allergySuggestionNames(r.resolvedDrugs);
    expect(names).toEqual([
      "Ацетилсалициловая кислота кардио",
      "Железа сульфат + аскорбиновая кислота",
      "Карбалекс",
      "Карбамазепин",
    ]);
    for (const n of names) {
      expect(n).not.toMatch(/uzr:|_/);
    }
    expect(allergySuggestionNames([{ nameRu: "Ибупрофен" }, { nameRu: "ибупрофен" }])).toEqual([
      "Ибупрофен",
    ]);
  });
});

// ── G4-21 ────────────────────────────────────────────────────────────────

describe("G4-21: one drug, one row", () => {
  const seed = [...DRUGS, ...DRUGS_EXTRA];

  it("no brand is seeded on two rows", () => {
    const owner = new Map<string, string>();
    for (const d of seed) {
      for (const b of d.brands ?? []) {
        const key = normName(b);
        const prev = owner.get(key);
        expect(prev === undefined || prev === d.id, `${b}: ${prev} and ${d.id}`).toBe(true);
        owner.set(key, d.id);
      }
    }
  });

  it("each copy is gone from the seed, its curated row is there with the copy's brands", () => {
    const ids = new Set(seed.map((d) => d.id));
    for (const { from, to } of DUPLICATE_DRUGS) {
      expect(ids.has(from), from).toBe(false);
      expect(DRUGS.some((d) => d.id === to), to).toBe(true);
    }
    const brandsOf = (id: string) => (seed.find((d) => d.id === id)?.brands ?? []).map(normName);
    expect(brandsOf("levodopa_carbidopa")).toEqual(expect.arrayContaining(["наком", "синдопа", "тидомет"]));
    expect(brandsOf("magnesium_b6")).toEqual(expect.arrayContaining(["магне b6", "магнелис b6"]));
    for (const { brand, from, to } of MISFILED_BRANDS) {
      expect(brandsOf(from)).not.toContain(normName(brand));
      expect(brandsOf(to)).toContain(normName(brand));
    }
  });

  it("the merge moves a brand the curated row lacks and drops a repeat", () => {
    expect(
      planBrandMerge(
        [
          { id: "b1", name: "МАГНЕ® B6" },
          { id: "b2", name: "Магнелис B6" },
          { id: "b3", name: "Магнелис  B6" },
        ],
        [{ name: "Магне B6" }],
      ),
    ).toEqual({ move: ["b2"], drop: ["b1", "b3"] });
  });

  it("a core-list entry folds into the curated one with every name kept", () => {
    expect(
      mergeFormularyAliases(
        { label: "Магне B6", aliases: ["Магнелис"] },
        { label: "Магне Б6", aliases: ["магнелис", "Магвит"] },
      ),
    ).toEqual(["Магнелис", "Магне Б6", "Магвит"]);
  });

  it("protocol drafts point at the curated row", () => {
    const items = [{ drugId: "magnesium-b6", displayName: "Магне B6" }, { drugId: "x" }];
    expect(repointDrafts(items, "magnesium-b6", "magnesium_b6")).toEqual([
      { drugId: "magnesium_b6", displayName: "Магне B6" },
      { drugId: "x" },
    ]);
    expect(repointDrafts(items, "colecalciferol", "vitamin_d3")).toBeNull();
    expect(repointDrafts(null, "a", "b")).toBeNull();
  });
});
