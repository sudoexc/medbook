/**
 * «Мой арсенал» — each doctor's own working set (owner request 03.10.2026:
 * «чтобы система прям знала каждого врача самые частые 10-20-30 назначений
 * и диагнозов, чтобы им максимально было удобно работать с их постоянным
 * арсеналом, мышкой»).
 *
 * Two lists per doctor and kind (drugs, diagnoses):
 *   - «Частые»: learned, his top 10/20/30 by how often he writes them;
 *   - «Мои», the arsenal: managed by hand, an ordered list of up to 30
 *     pins (DoctorFavorite rows, `sortOrder` = position), where a drug may
 *     carry his usual schema for one-click prescribing.
 *
 * Pure and shared: the API validates with it, the visit screen and the
 * arsenal page render with it, the tests drive it.
 */
import { isConcentrationOrPack, normalizeStrength } from "@/lib/catalogs/drug-forms";
import type {
  PrescriptionMealRelation,
  PrescriptionTimeOfDay,
} from "@/lib/catalogs/prescription-format";

/** Pins per kind. A longer list stops being a set he reaches for blind. */
export const ARSENAL_MAX = 30;

/** The «10 · 20 · 30» switch of a «Частые» column. */
export const FREQUENT_LIMITS = [10, 20, 30] as const;
export type FrequentLimit = (typeof FREQUENT_LIMITS)[number];
export const DEFAULT_FREQUENT_LIMIT: FrequentLimit = 20;

/**
 * A stored or requested limit as one of the three choices. Anything else
 * (a hand-edited row, an older client) shows the default rather than an
 * odd count the switch cannot display as selected.
 */
export function normalizeFrequentLimit(raw: unknown): FrequentLimit {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return (FREQUENT_LIMITS as readonly unknown[]).includes(n)
    ? (n as FrequentLimit)
    : DEFAULT_FREQUENT_LIMIT;
}

/** Which arsenal: the catalog's entity types the pins are stored under. */
export type ArsenalKind = "DRUG" | "ICD10";

// ───────────────────────── The drug schema ─────────────────────────

const TIME_ORDER: readonly PrescriptionTimeOfDay[] = [
  "MORNING",
  "NOON",
  "EVENING",
  "NIGHT",
];

const MEAL_RELATIONS: ReadonlySet<string> = new Set<PrescriptionMealRelation>([
  "BEFORE_MEAL",
  "WITH_MEAL",
  "AFTER_MEAL",
  "EMPTY_STOMACH",
  "NO_MATTER",
]);

/** Field caps: the same the visit row editor and its API allow. */
export const SCHEMA_LIMITS = {
  form: 60,
  strength: 60,
  dose: 160,
  instruction: 500,
  maxDays: 365,
} as const;

/**
 * His usual way of writing one drug, set on the arsenal page. Every field
 * is optional: a schema with only «утром и вечером, 10 дней» still saves
 * him those clicks, and the dose then comes from the catalog's default.
 */
export type DrugArsenalSchema = {
  form: string | null;
  strength: string | null;
  dose: string | null;
  timesOfDay: PrescriptionTimeOfDay[];
  mealRelation: PrescriptionMealRelation | null;
  durationDays: number | null;
  instructionRu: string | null;
  instructionUz: string | null;
};

export const EMPTY_DRUG_SCHEMA: DrugArsenalSchema = {
  form: null,
  strength: null,
  dose: null,
  timesOfDay: [],
  mealRelation: null,
  durationDays: null,
  instructionRu: null,
  instructionUz: null,
};

const strengthKey = (s: string) => normalizeStrength(s).toLowerCase().replace(/\s+/g, "");

/**
 * A «dose» that is only a strength copied over: a concentration or a pack
 * («500 мг/4 мл», «1 флакон») equal to one of the given strengths. The old
 * constructor wrote the strength into the dose untouched, and that was
 * never his dose (audit G4-07; the visit's «Частые» path drops it the same
 * way, prescription-rows.ts). A dose he wrote («1000 мг», «2 мл», «1 таб.»)
 * is not one.
 */
export function isStrengthCopiedAsDose(
  dose: string | null | undefined,
  strengths: readonly (string | null | undefined)[],
): boolean {
  const d = dose?.trim();
  if (!d || !isConcentrationOrPack(d)) return false;
  const key = strengthKey(d);
  return strengths.some((s) => !!s?.trim() && strengthKey(s) === key);
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}

/**
 * A schema as stored (JSON) or sent, cleaned: unknown times and meal values
 * dropped, times in the canonical morning → night order, texts trimmed and
 * capped, days a whole number in 1..365. Null when nothing is left, so «no
 * schema» has one spelling and the pick falls back to his history.
 *
 * WHY tolerant rather than strict: the column is JSON, read back on every
 * visit; a value a later build no longer knows must never reach the
 * replace-all save of the prescription list, nor make the column unusable.
 */
export function parseDrugArsenalSchema(raw: unknown): DrugArsenalSchema | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const times = Array.isArray(o.timesOfDay) ? o.timesOfDay : [];
  const days =
    typeof o.durationDays === "number" &&
    Number.isInteger(o.durationDays) &&
    o.durationDays >= 1 &&
    o.durationDays <= SCHEMA_LIMITS.maxDays
      ? o.durationDays
      : null;
  const form = text(o.form, SCHEMA_LIMITS.form);
  const strength = text(o.strength, SCHEMA_LIMITS.strength);
  const dose = text(o.dose, SCHEMA_LIMITS.dose);
  const schema: DrugArsenalSchema = {
    form,
    // A strength belongs to a form; without one it is still the doctor's
    // («10 мг» of whatever form the catalog starts with).
    strength,
    // Its own strength as the dose is no dose: kept, one click from «Мои»
    // would add the row with «500 мг/4 мл» as «Доза» and skip the prompt.
    dose: isStrengthCopiedAsDose(dose, [strength]) ? null : dose,
    timesOfDay: TIME_ORDER.filter((t) => times.includes(t)),
    mealRelation:
      typeof o.mealRelation === "string" && MEAL_RELATIONS.has(o.mealRelation)
        ? (o.mealRelation as PrescriptionMealRelation)
        : null,
    durationDays: days,
    instructionRu: text(o.instructionRu, SCHEMA_LIMITS.instruction),
    instructionUz: text(o.instructionUz, SCHEMA_LIMITS.instruction),
  };
  return isEmptyDrugSchema(schema) ? null : schema;
}

/** What he wrote last time of one drug (the shortlist's `last*` fields). */
export type DrugUsualFields = {
  lastForm?: string | null;
  lastStrength?: string | null;
  lastDose?: string | null;
  lastTimesOfDay?: readonly string[];
  lastMealRelation?: string | null;
  lastDurationDays?: number | null;
};

/**
 * What he wrote last time, as the starting point of a schema he never set
 * on «Мой арсенал». A last dose that is that row's strength copied over is
 * left out, as on the visit's «Частые» path (review of 03.10.2026): saved
 * into the schema, it reached the handout as the dose with no prompt.
 */
export function schemaFromUsual(u: DrugUsualFields): DrugArsenalSchema {
  const dose = isStrengthCopiedAsDose(u.lastDose, [u.lastStrength]) ? null : u.lastDose;
  return (
    parseDrugArsenalSchema({
      form: u.lastForm,
      strength: u.lastStrength,
      dose,
      timesOfDay: u.lastTimesOfDay,
      mealRelation: u.lastMealRelation,
      durationDays: u.lastDurationDays,
    }) ?? EMPTY_DRUG_SCHEMA
  );
}

/** Nothing in it that a pick could use. */
export function isEmptyDrugSchema(s: DrugArsenalSchema | null | undefined): boolean {
  if (!s) return true;
  return (
    !s.form &&
    !s.strength &&
    !s.dose &&
    s.timesOfDay.length === 0 &&
    // «Не важно» is the row default: on its own it says nothing.
    (s.mealRelation === null || s.mealRelation === "NO_MATTER") &&
    s.durationDays === null &&
    !s.instructionRu &&
    !s.instructionUz
  );
}

// ───────────────────────── Order ─────────────────────────

export type ArsenalPin = {
  entityCode: string;
  sortOrder: number;
  createdAt: Date | string;
};

/**
 * Pins in arsenal order: position, then the older first (two pins made in
 * the same second share an epoch-seconds position), each code once.
 */
export function orderArsenal<T extends ArsenalPin>(pins: readonly T[]): T[] {
  const time = (v: Date | string) =>
    typeof v === "string" ? new Date(v).getTime() : v.getTime();
  const seen = new Set<string>();
  return [...pins]
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        time(a.createdAt) - time(b.createdAt) ||
        (a.entityCode < b.entityCode ? -1 : a.entityCode > b.entityCode ? 1 : 0),
    )
    .filter((p) => {
      if (seen.has(p.entityCode)) return false;
      seen.add(p.entityCode);
      return true;
    });
}

/**
 * The positions a drag-to-reorder writes: 0..n-1 in the new order.
 *
 * WHY a whole permutation and not «move X before Y»: the page sends the
 * order the doctor sees, and a list changed meanwhile (a star clicked on
 * the visit screen in another tab) must be refused, not merged into an
 * order nobody looked at. So the new order must hold exactly the current
 * codes, each once.
 */
export function reorderedPositions(
  current: readonly string[],
  next: readonly string[],
): { ok: true; positions: { entityCode: string; sortOrder: number }[] } | { ok: false } {
  if (next.length !== current.length) return { ok: false };
  const have = new Set(current);
  const seen = new Set<string>();
  for (const code of next) {
    if (!have.has(code) || seen.has(code)) return { ok: false };
    seen.add(code);
  }
  return {
    ok: true,
    positions: next.map((entityCode, sortOrder) => ({ entityCode, sortOrder })),
  };
}

/**
 * The position of a new pin: after every other one. Epoch seconds is what
 * a star click has always written (doctor-favorites); after a reorder the
 * positions are small, and either way the new pin lands last.
 */
export function nextArsenalPosition(
  existing: readonly { sortOrder: number }[],
  nowMs = Date.now(),
): number {
  const last = existing.reduce((m, p) => Math.max(m, p.sortOrder), -1);
  return Math.max(last + 1, Math.floor(nowMs / 1000));
}

// ───────────────────────── Who may edit ─────────────────────────

export type ArsenalActor = {
  role: string;
  userId: string;
  clinicId: string;
};

export type ArsenalTarget = {
  /** The doctor's login; null when his card has none yet. */
  userId: string | null;
  clinicId: string;
};

/**
 * A doctor edits his own arsenal; the clinic's ADMIN (and a SUPER_ADMIN
 * acting inside the clinic) any doctor's of that clinic, so the owner can
 * prepare it for him. Nobody else, and never across clinics.
 */
export function canManageArsenal(actor: ArsenalActor, target: ArsenalTarget): boolean {
  if (actor.clinicId !== target.clinicId) return false;
  if (actor.role === "ADMIN" || actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "DOCTOR") return !!target.userId && target.userId === actor.userId;
  return false;
}

// ───────────────────────── «Частые» with the core list ─────────────────────────

/**
 * «Частые» of N drugs: his own top N, and when he has fewer, the clinic's
 * core list continues the column (in clinic-wide use order) up to N, minus
 * what is already his. A doctor who has hardly prescribed in the CRM yet
 * (the clinic's busiest one has 15 structured rows) gets a useful column on
 * day one instead of an empty one.
 */
export function frequentWithCore<T extends { key: string; drugId: string | null }>(
  own: readonly T[],
  core: readonly T[],
  limit: number,
): { own: T[]; core: T[] } {
  const mine = own.slice(0, limit);
  const room = limit - mine.length;
  if (room <= 0) return { own: mine, core: [] };
  const taken = new Set<string>();
  for (const i of mine) {
    taken.add(i.key);
    if (i.drugId) taken.add(i.drugId);
  }
  const fill: T[] = [];
  for (const c of core) {
    if (fill.length >= room) break;
    if (taken.has(c.key) || (c.drugId && taken.has(c.drugId))) continue;
    taken.add(c.key);
    if (c.drugId) taken.add(c.drugId);
    fill.push(c);
  }
  return { own: mine, core: fill };
}

/**
 * The clinic's core list in clinic-wide use order: most written first
 * (`uses` by drug id), ties and unused drugs in the clinic's own order.
 */
export function rankCoreByUse(
  coreIds: readonly string[],
  uses: ReadonlyMap<string, number>,
): string[] {
  return coreIds
    .map((id, index) => ({ id, index, n: uses.get(id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.index - b.index)
    .map((e) => e.id);
}
