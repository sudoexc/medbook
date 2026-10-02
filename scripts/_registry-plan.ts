/**
 * Pure planning for the state register import (`import-uzpharm-registry.ts`)
 * and its data fix (`fix-ct03-registry-brand-homes.ts`), kept apart so unit
 * tests can pin it against the real register without a database (audit
 * CT-03).
 *
 * The register (prisma/uzpharm-registry.json) groups registrations by
 * composition: «толперизон» and «лидокаин + толперизон» are two entities,
 * each with its own brands. The first import looked for a «home» for each
 * entity by its name and then by ANY of its brands, and a brand is not a
 * substance: ТОЛКИМАДО is registered both as tolperisone tablets and as
 * tolperisone + lidocaine ampoules. So «лидокаин + толперизон» landed on the
 * tolperisone row with МИОСПАН, МИОФЛЕКС and five other brands, its own row
 * was never created, and a patient allergic to lidocaine got no warning for
 * Миоспан. Хлоргексидин (Гексикон, Септум) landed on the lozenge row
 * «бензокаин + хлоргексидин + эноксолон» the same way: 18 entities in all.
 *
 * Now an entity finds its home only through the substance:
 *   1. its own id (a row an earlier import created);
 *   2. `SAME_SUBSTANCE_HOMES`, the curated rows reviewed by hand whose name
 *      is a brand or a salt («Амоксиклав», «Левотироксин»);
 *   3. the same composition, whatever the order and case of its parts
 *      («карбидопа + леводопа» is the curated «Леводопа + карбидопа»,
 *      «пиридоксин» the curated «Пиридоксин (витамин B6)»);
 *   4. for a trade-name entity with no МНН, whose composition this entity
 *      does not state: the register entity that lists the trade name as its
 *      brand, when its ATC group agrees («МЕКСИДОЛ®» is a brand of
 *      этилметилгидроксипиридина сукцинат); failing that, a curated row that
 *      lists the trade name as its brand. Where several do, only one whose
 *      composition contains all the others' qualifies (see `widest`).
 *      ФЕРОМАКС, an iron syrup (B03AB) that the register also lists under
 *      folic acid (B03BB), stays its own row.
 * Anything else becomes its own row, and its brands go with it. A brand the
 * register lists under several compositions stays on each of them and is
 * reported: which one the doctor means is his call, not the importer's.
 *
 * Clinic-owned drugs (clinicId set) are never a home: they belong to one
 * clinic, and the import writes the shared catalog.
 */
import { DRUGS as DRUGS_CORE } from "../prisma/_drug-catalog";
import { DRUGS_EXTRA } from "../prisma/_drug-catalog-extra";

export type RegistryEntity = {
  id: string;
  inn: string;
  nameRu: string;
  atcCode: string | null;
  category: string;
  rxOnly: boolean;
  isTradeEntity: boolean;
  forms: { form: string; strengths: string[] }[];
  brands: { name: string; manufacturer: string | null; country: string | null }[];
};

export type CatalogDrug = {
  id: string;
  inn: string;
  nameRu: string;
  clinicId: string | null;
  /** Rows with an ATC code carry the curated clinical data; they win a tie. */
  atcCode?: string | null;
};

export type CatalogBrand = {
  id?: string;
  drugId: string;
  name: string;
};

/** How an entity found its home. */
export type HomeVia =
  | "id"
  | "same-substance"
  | "name"
  | "composition"
  | "trade-name"
  | "new";

export type RegistryPlan = {
  homes: Map<string, { drugId: string; via: HomeVia }>;
  /** Entities that become rows of their own and do not exist yet. */
  newDrugs: RegistryEntity[];
  /** Brand rows the catalog should have and does not. */
  brandRows: { drugId: string; name: string; manufacturer: string | null }[];
  /** Brands the register lists under entities of different composition. */
  conflicts: { brand: string; entities: { id: string; nameRu: string }[] }[];
};

/**
 * Curated rows named by a brand or a salt, so the composition rule cannot
 * see them, reviewed by hand against the register (28.09.2026). Each pair is
 * one active substance; the curated row keeps its clinical data (dosing,
 * contraindications, allergy class) and gains the register's brands.
 */
export const SAME_SUBSTANCE_HOMES: Readonly<Record<string, string>> = {
  // The register spells it «колекальциферол»; the curated row is
  // «Витамин D3 (холекальциферол)».
  "uzr-kolekaltsiferol": "vitamin_d3",
  // Sodium salt of the same substance (curated brands Эутирокс, L-Тироксин).
  "uzr-levotiroksin-natriya": "lthyroxine",
  // Curated «Бепантен», INN Dexpanthenol.
  "uzr-dekspantenol": "bepanten",
  // Curated «Амоксиклав», INN Amoxicillin + Clavulanate.
  "uzr-amoksitsillin-klavulanovaya-kislota": "amoxiclav",
  // Curated «Ко-тримоксазол», INN Sulfamethoxazole + Trimethoprim.
  "uzr-sulfametoksazol-trimetoprim": "co_trimoxazole",
  // Arginine salt of perindopril (curated brand Престариум).
  "uzr-perindoprila-arginin": "perindopril",
  // Sodium salt; the curated «Диклофенак» is what doctors write.
  "uzr-diklofenak-natriya": "diclofenac",
};

/**
 * Brands the normalised payload filed under one of their substances alone.
 * The register registers АСПИРИН® С (Bayer) with two active substances,
 * acetylsalicylic acid and ascorbic acid; the payload grouped it under
 * «аскорбиновая кислота», so the import gave it the vitamin C row: an aspirin
 * allergy and the NSAID rules never saw it, and a plain vitamin C carried an
 * aspirin brand. Each brand here moves to the entity of its registered
 * composition, and the substances of that composition are what the CDS
 * engine resolves (see substance-profile.ts). Only compositions the register
 * states: a composition that cannot be read from it is not guessed.
 */
export const REGISTER_COMPOSITION_FIXES: readonly {
  brand: string;
  /** The entity the payload filed the brand under. */
  from: string;
  /** The entity of the registered composition, created when missing. */
  to: Omit<RegistryEntity, "brands">;
}[] = [
  {
    brand: "АСПИРИН® С",
    from: "uzr-askorbinovaya-kislota",
    to: {
      id: "uzr-atsetilsalitsilovaya-kislota-askorbinovaya-kislota",
      inn: "uzr:atsetilsalitsilovaya-kislota-askorbinovaya-kislota",
      nameRu: "ацетилсалициловая кислота + аскорбиновая кислота",
      // WHO ATC: acetylsalicylic acid, combinations excl. psycholeptics.
      atcCode: "N02BA51",
      // As the register's own acetylsalicylic acid entity: an analgesic,
      // sold without a prescription.
      category: "ANALGESIC",
      rxOnly: false,
      isTradeEntity: false,
      // Effervescent tablets; the payload merges strengths per entity, so
      // none can be attributed to this brand.
      forms: [{ form: "TAB", strengths: [] }],
    },
  },
];

/**
 * ATC groups the payload filed under the wrong category (audit CT-15). Its
 * mapping went by the anatomical letter, so A10 (metformin, the insulins,
 * the gliflozins: 32 entities) landed in GI with the antacids, and the M03
 * muscle relaxants (tolperisone, tizanidine: 16) in OTHER. The curated
 * catalog files both groups ENDOCRINE and NEUROLOGICAL, and the reference
 * filters by category. `from` keeps the fix to rows still in the wrong one.
 */
export const REGISTER_CATEGORY_FIXES: readonly {
  atc: string;
  from: string;
  to: string;
}[] = [
  { atc: "A10", from: "GI", to: "ENDOCRINE" },
  { atc: "M03", from: "OTHER", to: "NEUROLOGICAL" },
];

/** A register row's category with `REGISTER_CATEGORY_FIXES` applied. */
export function registerCategory(
  atcCode: string | null,
  category: string,
): string {
  const atc = atcCode?.trim().toUpperCase() ?? "";
  const fix = REGISTER_CATEGORY_FIXES.find(
    (f) => category === f.from && atc.startsWith(f.atc),
  );
  return fix ? fix.to : category;
}

/**
 * The payload with `REGISTER_COMPOSITION_FIXES` and
 * `REGISTER_CATEGORY_FIXES` applied. A fix whose brand is no longer where it
 * names (a newer payload files it right) does nothing.
 */
export function correctRegisterEntities(
  entities: readonly RegistryEntity[],
): RegistryEntity[] {
  let out = entities.map((e) => {
    const category = registerCategory(e.atcCode, e.category);
    return category === e.category ? e : { ...e, category };
  });
  for (const fix of REGISTER_COMPOSITION_FIXES) {
    const key = normName(fix.brand);
    const brand = out
      .find((e) => e.id === fix.from)
      ?.brands.find((b) => normName(b.name) === key);
    if (!brand) continue;
    out = out.map((e) =>
      e.id === fix.from
        ? { ...e, brands: e.brands.filter((b) => normName(b.name) !== key) }
        : e,
    );
    if (out.some((e) => e.id === fix.to.id)) {
      out = out.map((e) =>
        e.id === fix.to.id ? { ...e, brands: [...e.brands, brand] } : e,
      );
    } else {
      out.push({ ...fix.to, forms: fix.to.forms.map((f) => ({ ...f })), brands: [brand] });
    }
  }
  return out;
}

/** The seed's own brand lists by drug id: what the curated rows vouch for. */
export function curatedBrandMap(): Map<string, string[]> {
  return new Map(
    [...DRUGS_CORE, ...DRUGS_EXTRA].map((d) => [d.id, d.brands ?? []]),
  );
}

/** Case, ё, ®/™ and spacing folded: how names and brands are compared. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[®™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The curated brands (prisma/_drug-catalog*.ts) a drug row does not carry
 * yet, compared with `normName`, each once, in source order. What
 * prisma/seed-drugs.ts adds (audit G4-10): it used to delete every brand of
 * each curated drug and re-insert the source list, wiping the ~1800 trade
 * names this import had hung on those same rows («МЕЗАКАР® SR», «ЭНАП®»), so
 * doctors stopped finding them and the allergy checks stopped matching. A
 * brand row is never removed by a seed now; a wrong one is a data fix.
 */
export function curatedBrandsToAdd(
  existing: readonly string[],
  curated: readonly string[],
): string[] {
  const have = new Set(existing.map(normName));
  const out: string[] = [];
  for (const name of curated) {
    const key = normName(name);
    if (!key || have.has(key)) continue;
    have.add(key);
    out.push(name);
  }
  return out;
}

/** One dosage form as a Drug row stores it in `forms`. */
export type DrugFormEntry = { form: string; strengths: string[] };

/** Strengths differ only by spacing in the register («200мг» vs «200 мг»). */
function normStrength(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/,/g, ".");
}

/**
 * Union of two form lists: every form of either, in first-seen order, each
 * with the union of its strengths (the first spelling of a strength wins).
 * Shared by scripts/enrich-drug-forms.ts, which merges the register's forms
 * into the curated rows, and prisma/seed-drugs.ts (audit G2-18): the seed
 * used to write the source list over `forms` on every run, so a reseed took
 * back the injectable АЦЦ the enrichment had added and the prescription
 * constructor stopped offering it. Nothing is ever dropped here.
 */
export function mergeDrugForms(
  current: readonly DrugFormEntry[],
  incoming: readonly DrugFormEntry[],
): DrugFormEntry[] {
  const byForm = new Map<string, string[]>();
  for (const src of [current, incoming]) {
    for (const f of src) {
      if (!f?.form) continue;
      let list = byForm.get(f.form);
      if (!list) {
        list = [];
        byForm.set(f.form, list);
      }
      for (const s of f.strengths ?? []) {
        if (!list.some((v) => normStrength(v) === normStrength(s))) list.push(s);
      }
    }
  }
  return [...byForm].map(([form, strengths]) => ({ form, strengths }));
}

/**
 * The substances a name lists, order-free: «Леводопа + карбидопа» and
 * «карбидопа + леводопа» give one key. Brackets stay: in the register they
 * tell products apart («… (для детей)» is not «… (для взрослых)»).
 */
export function compositionKey(name: string): string {
  return normName(name)
    .split(/\s*\+\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .sort()
    .join(" + ");
}

/**
 * The keys a hand-written curated row answers to: its name without the
 * bracketed alias, and the alias when it names the substance («Пиридоксин
 * (витамин B6)» is «пиридоксин»; «Витамин D3 (холекальциферол)» is also
 * «холекальциферол»).
 */
export function curatedKeys(name: string): string[] {
  const keys = [compositionKey(name.replace(/\([^)]*\)/g, " "))];
  for (const m of name.matchAll(/\(([^)]*)\)/g)) keys.push(compositionKey(m[1]!));
  return keys.filter(Boolean);
}

/**
 * Of several compositions, the one that contains every other, if any:
 * «железа сульфат» and «аскорбиновая кислота + железа сульфат» → the
 * latter. When the sources disagree on a trade name only by leaving a part
 * out, the fuller one lets the allergy and interaction checks see every
 * substance.
 */
function widest(keys: readonly string[]): string | null {
  const sets = [...new Set(keys)].map((k) => ({ k, parts: new Set(k.split(" + ")) }));
  const top = sets.find((a) => sets.every((b) => [...b.parts].every((p) => a.parts.has(p))));
  return top?.k ?? null;
}

/**
 * Two ATC codes that could be one product: equal down to the pharmacological
 * subgroup (4 characters), or one of them unknown.
 */
function atcAgrees(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a.slice(0, 4).toUpperCase() === b.slice(0, 4).toUpperCase();
}

/** Registry and clinic rows keep a slug in `inn` («uzr:tolperizon»), not a name. */
function innIsName(inn: string): boolean {
  return !/[_:]/.test(inn);
}

function isRegistryRow(id: string): boolean {
  return id.startsWith("uzr-");
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key) ?? map.set(key, []).get(key)!;
  if (!list.includes(value)) list.push(value);
}

export function planRegistryImport(input: {
  entities: readonly RegistryEntity[];
  drugs: readonly CatalogDrug[];
  brands: readonly CatalogBrand[];
  /** Curated seed brands by drug id (prisma/_drug-catalog*.ts). */
  curatedBrands: ReadonlyMap<string, readonly string[]>;
}): RegistryPlan {
  const entities = correctRegisterEntities(input.entities);
  const global = input.drugs.filter((d) => d.clinicId === null);
  const globalIds = new Set(global.map((d) => d.id));
  const drugById = new Map(global.map((d) => [d.id, d]));

  // Brands each shared row carries now.
  const existing = new Map<string, Set<string>>();
  for (const b of input.brands) {
    if (!globalIds.has(b.drugId)) continue;
    const set = existing.get(b.drugId) ?? existing.set(b.drugId, new Set()).get(b.drugId)!;
    set.add(normName(b.name));
  }

  // Name and composition → candidate rows. A curated row goes before a
  // register row, a row with an ATC code (the curated clinical data) before
  // its bare twin, then by id: the richest row is the home.
  const rank = (id: string) => {
    const d = drugById.get(id);
    return [Number(isRegistryRow(id)), Number(!d?.atcCode), id] as const;
  };
  const byRank = (a: string, b: string) => {
    const [ra, rb] = [rank(a), rank(b)];
    return ra[0] - rb[0] || ra[1] - rb[1] || (ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0);
  };
  const byName = new Map<string, string[]>();
  const byComposition = new Map<string, string[]>();
  for (const d of [...global].sort((a, b) => byRank(a.id, b.id))) {
    const names = innIsName(d.inn) ? [d.nameRu, d.inn] : [d.nameRu];
    for (const name of names) {
      push(byName, normName(name), d.id);
      const keys = isRegistryRow(d.id) ? [compositionKey(name)] : curatedKeys(name);
      for (const key of keys) push(byComposition, key, d.id);
    }
  }

  // Which register entities list each brand.
  const owners = new Map<string, Set<string>>();
  for (const e of entities) {
    for (const b of e.brands) {
      const bn = normName(b.name);
      (owners.get(bn) ?? owners.set(bn, new Set()).get(bn)!).add(e.id);
    }
  }

  // Curated rows by the brands the seed gives them.
  const curatedHolders = new Map<string, string[]>();
  for (const [drugId, names] of input.curatedBrands) {
    if (!globalIds.has(drugId)) continue;
    for (const n of names) push(curatedHolders, normName(n), drugId);
  }

  /**
   * One of several equal candidates (a curated row and its twin, two rows of
   * one name): the one already carrying most of the entity's brands, which
   * keeps a re-run on a live catalog where the last import put them; else
   * the best ranked.
   */
  const pick = (e: RegistryEntity, candidates: readonly string[]): string => {
    if (candidates.length === 1) return candidates[0]!;
    const overlap = (id: string) =>
      e.brands.filter((b) => existing.get(id)?.has(normName(b.name))).length;
    return [...candidates].sort((a, b) => overlap(b) - overlap(a) || byRank(a, b))[0]!;
  };

  const byEntity = new Map(entities.map((e) => [e.id, e]));
  const homes: RegistryPlan["homes"] = new Map();
  const newDrugs: RegistryEntity[] = [];
  const known = new Set(globalIds);

  const direct = (e: RegistryEntity): { drugId: string; via: HomeVia } | null => {
    if (known.has(e.id)) return { drugId: e.id, via: "id" };
    const curated = SAME_SUBSTANCE_HOMES[e.id];
    if (curated && known.has(curated)) return { drugId: curated, via: "same-substance" };
    const named = byName.get(normName(e.nameRu));
    if (named?.length) return { drugId: pick(e, named), via: "name" };
    const composed = byComposition.get(compositionKey(e.nameRu));
    if (composed?.length) return { drugId: pick(e, composed), via: "composition" };
    return null;
  };

  const settle = (e: RegistryEntity, found: { drugId: string; via: HomeVia } | null) => {
    let home = found;
    if (!home) {
      home = { drugId: e.id, via: "new" };
      newDrugs.push(e);
      known.add(e.id);
      // A later entity of the same name or composition folds into this one.
      push(byName, normName(e.nameRu), e.id);
      push(byComposition, compositionKey(e.nameRu), e.id);
    }
    homes.set(e.id, home);
  };

  // Entities with a composition first: a trade-name entity may fold into
  // the home of the one that lists its name as a brand.
  for (const e of entities) {
    if (!e.isTradeEntity) settle(e, direct(e));
  }
  for (const e of entities) {
    if (!e.isTradeEntity) continue;
    let home = direct(e);
    const bn = normName(e.nameRu);
    if (!home) {
      const claimants = [...(owners.get(bn) ?? [])]
        .filter((id) => id !== e.id)
        .map((id) => byEntity.get(id)!)
        .filter((c) => !c.isTradeEntity);
      const top = widest(claimants.map((c) => compositionKey(c.nameRu)));
      const chosen = claimants.find((c) => compositionKey(c.nameRu) === top);
      if (chosen && atcAgrees(chosen.atcCode, e.atcCode)) {
        home = { drugId: homes.get(chosen.id)!.drugId, via: "trade-name" };
      }
    }
    if (!home) {
      // The curated seed lists the name as a brand (twins of one row count
      // once; of nested compositions the fullest wins, see `widest`).
      const rows = curatedHolders.get(bn) ?? [];
      const keyOf = (id: string) => curatedKeys(drugById.get(id)!.nameRu)[0] ?? id;
      const top = widest(rows.map(keyOf));
      const fitting = rows.filter((id) => keyOf(id) === top);
      if (fitting.length > 0) {
        home = { drugId: pick(e, fitting), via: "trade-name" };
      }
    }
    settle(e, home);
  }

  const brandRows: RegistryPlan["brandRows"] = [];
  for (const e of entities) {
    const drugId = homes.get(e.id)!.drugId;
    const have = existing.get(drugId) ?? existing.set(drugId, new Set()).get(drugId)!;
    for (const b of e.brands) {
      const bn = normName(b.name);
      // A brand spelled like the entity's own name adds nothing to search.
      if (have.has(bn) || bn === normName(e.nameRu)) continue;
      have.add(bn);
      brandRows.push({ drugId, name: b.name, manufacturer: b.manufacturer });
    }
  }

  const conflicts: RegistryPlan["conflicts"] = [];
  for (const [brand, ids] of owners) {
    const list = [...ids].map((id) => byEntity.get(id)!);
    const compositions = new Set(
      list.filter((e) => !e.isTradeEntity).map((e) => compositionKey(e.nameRu)),
    );
    if (compositions.size > 1) {
      conflicts.push({
        brand,
        entities: list.map((e) => ({ id: e.id, nameRu: e.nameRu })),
      });
    }
  }
  conflicts.sort((a, b) => (a.brand < b.brand ? -1 : a.brand > b.brand ? 1 : 0));

  return { homes, newDrugs, brandRows, conflicts };
}

/**
 * The data fix on top of the import plan: brand rows the first import put on
 * a row of another composition. A brand row is misplaced when its name is a
 * register brand, it sits on a shared (non-clinic) row, and none of the
 * brand's register owners has its home there, nor does the curated seed list
 * it for that row. Everything the fix does not recognise stays.
 */
export function planBrandRevision(input: {
  entities: readonly RegistryEntity[];
  drugs: readonly CatalogDrug[];
  brands: readonly CatalogBrand[];
  /** Curated seed brands by drug id (prisma/_drug-catalog*.ts). */
  curatedBrands: ReadonlyMap<string, readonly string[]>;
}): RegistryPlan & { misplaced: (CatalogBrand & { reason: string })[] } {
  const plan = planRegistryImport(input);
  const entities = correctRegisterEntities(input.entities);
  const globalIds = new Set(
    input.drugs.filter((d) => d.clinicId === null).map((d) => d.id),
  );

  // Brand names that belong on each row: its register entities' brands,
  // their own names, and the curated seed's brands.
  const legit = new Map<string, Set<string>>();
  const add = (drugId: string, name: string) =>
    (legit.get(drugId) ?? legit.set(drugId, new Set()).get(drugId)!).add(normName(name));
  const owners = new Map<string, string[]>();
  for (const e of entities) {
    const home = plan.homes.get(e.id)!.drugId;
    add(home, e.nameRu);
    for (const b of e.brands) {
      add(home, b.name);
      const bn = normName(b.name);
      (owners.get(bn) ?? owners.set(bn, []).get(bn)!).push(e.nameRu);
    }
  }
  for (const [drugId, names] of input.curatedBrands) {
    for (const n of names) add(drugId, n);
  }

  const misplaced: (CatalogBrand & { reason: string })[] = [];
  for (const b of input.brands) {
    if (!globalIds.has(b.drugId)) continue;
    const bn = normName(b.name);
    const ownedBy = owners.get(bn);
    if (!ownedBy) continue;
    if (legit.get(b.drugId)?.has(bn)) continue;
    misplaced.push({ ...b, reason: `register lists it under ${ownedBy.join(" | ")}` });
  }
  return { ...plan, misplaced };
}

/**
 * The part of the brand revision that `REGISTER_COMPOSITION_FIXES` are
 * about (fix-p4-register-compositions.ts): the rows of the registered
 * compositions, and their brands' moves. Anything else the revision would
 * find is left to the CT-03 fix.
 */
export function planCompositionFixes(
  input: Parameters<typeof planBrandRevision>[0],
): Pick<ReturnType<typeof planBrandRevision>, "newDrugs" | "misplaced" | "brandRows"> {
  const plan = planBrandRevision(input);
  const brands = new Set(REGISTER_COMPOSITION_FIXES.map((f) => normName(f.brand)));
  const rows = new Set(REGISTER_COMPOSITION_FIXES.map((f) => f.to.id));
  return {
    newDrugs: plan.newDrugs.filter((e) => rows.has(e.id)),
    misplaced: plan.misplaced.filter((m) => brands.has(normName(m.name))),
    brandRows: plan.brandRows.filter(
      (b) => brands.has(normName(b.name)) && rows.has(b.drugId),
    ),
  };
}
