/**
 * Phase G6 / Ф4 — clinic-side overlay for curated catalogs.
 *
 * Two layers, both keyed by (entityType, entityCode):
 *
 *   • hide  — `hideGlobal: true` removes a global row from doctor-facing
 *     search/order surfaces for this clinic (G6 MVP, unchanged).
 *   • override — `overridesJson` (Ф4) is a patch of WHITELISTED fields
 *     merged over the global row at read time. The whitelist is the
 *     contract: anything else in the stored JSON is ignored on read, so a
 *     hand-edited DB row can never inject `id` / `clinicId` / `active`.
 *
 * An override may rephrase or add medical information, never erase it
 * (audit CT-10). The settings form sent the whole dosing object with only
 * adult/pediatric/renal in it, and the shallow merge replaced the global
 * object: one edit of a drug's NAME wiped the «Пожилым» dosing line for every
 * doctor of the clinic, and an empty form wiped all dosing. Now
 * `defaultDosing` merges per line (adult, pediatric, elderly, renal), and a
 * null / empty dosing, contraindication or side-effect list in a patch is
 * dropped instead of blanking the global text. The write route also stores
 * only what differs from the global row (`minimizeOverrides`).
 *
 * Clinic-local rows (clinicId set) are never hidden nor overridden — the
 * clinic edits them directly via /api/crm/knowledge/*.
 *
 * Returns an empty overlay when the caller has no clinicId (SUPER_ADMIN
 * looking at the platform-wide view) so they still see pristine globals.
 */
import { prisma } from "@/lib/prisma";
import type { CatalogEntityType } from "@/generated/prisma/client";

/**
 * Fields a clinic may override per entity type. Shared by the write route
 * (sanitizes incoming JSON) and the read-side merge (defense in depth).
 */
export const OVERLAY_FIELD_WHITELIST = {
  DRUG: [
    "nameRu",
    "nameUz",
    "defaultDosing",
    "contraindications",
    "sideEffects",
    "rxOnly",
    // Packaging photo uploaded by this clinic for a global catalog row.
    "photoUrl",
  ],
  GUIDE: [
    "titleRu",
    "titleUz",
    "whatToDoRu",
    "whatToDoUz",
    "careRu",
    "careUz",
    "lifestyleRu",
    "lifestyleUz",
    "redFlagsRu",
    "redFlagsUz",
    "adviceChips",
    "defaultFollowUpDays",
  ],
  HANDOUT: ["titleRu", "titleUz", "summaryRu", "bodyMd", "bodyMdUz", "topic"],
} as const satisfies Partial<Record<CatalogEntityType, readonly string[]>>;

export type OverridableEntityType = keyof typeof OVERLAY_FIELD_WHITELIST;

export function isOverridableEntityType(
  t: CatalogEntityType,
): t is OverridableEntityType {
  return t in OVERLAY_FIELD_WHITELIST;
}

/**
 * Medical safety copy: a patch can change it but never blank it. A null or
 * an empty list here is dropped (the global text stays).
 */
const PROTECTED_FIELDS: Partial<Record<OverridableEntityType, readonly string[]>> = {
  DRUG: ["defaultDosing", "contraindications", "sideEffects"],
};

/**
 * Object fields merged key by key over the global object instead of
 * replacing it: a patch of the adult dosing keeps the global elderly line.
 * Only non-empty string lines of a patch count.
 */
const MERGED_OBJECT_FIELDS: Partial<Record<OverridableEntityType, readonly string[]>> = {
  DRUG: ["defaultDosing"],
};

/**
 * Fields the overlay stores that are not an edit of the catalog text: the
 * clinic's packaging photo (managed by its own upload route). They do not
 * make a row read as «изменено клиникой».
 */
const NON_TEXT_FIELDS: ReadonlySet<string> = new Set(["photoUrl"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The non-empty string lines of a merged-object patch, or null when none. */
function cleanObjectLines(v: unknown): Record<string, string> | null {
  if (!isPlainObject(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, line] of Object.entries(v)) {
    if (typeof line === "string" && line.trim() !== "") out[k] = line.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Keep `overridesJson` payloads bounded — they ride along every catalog read. */
export const OVERLAY_OVERRIDES_MAX_JSON = 20_000;

export type ClinicOverlays = {
  hidden: Set<string>;
  overrides: Map<string, Record<string, unknown>>;
};

const EMPTY_OVERLAYS: ClinicOverlays = {
  hidden: new Set(),
  overrides: new Map(),
};

/**
 * Drop everything outside the per-type whitelist. `undefined` values are
 * dropped too (an override either sets a field or leaves the global value),
 * and so is anything that would erase protected medical copy (see
 * PROTECTED_FIELDS); merged object fields keep their non-empty lines only.
 */
export function sanitizeOverrides(
  entityType: OverridableEntityType,
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed = OVERLAY_FIELD_WHITELIST[entityType] as readonly string[];
  const protectedFields = PROTECTED_FIELDS[entityType] ?? [];
  const merged = MERGED_OBJECT_FIELDS[entityType] ?? [];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (merged.includes(key)) {
      const lines = cleanObjectLines(v);
      if (lines) out[key] = lines;
      continue;
    }
    if (protectedFields.includes(key)) {
      if (v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
    }
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Keep only what differs from the global row: a field (or a merged-object
 * line) equal to the global value is no override at all, so saving the form
 * unchanged stores nothing and a later fix to the global text still reaches
 * the clinic. Returns null when nothing differs.
 */
export function minimizeOverrides(
  entityType: OverridableEntityType,
  overrides: Record<string, unknown>,
  globalRow: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged = MERGED_OBJECT_FIELDS[entityType] ?? [];
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(overrides)) {
    if (merged.includes(key) && isPlainObject(v)) {
      const base = isPlainObject(globalRow[key]) ? globalRow[key] : {};
      const lines: Record<string, unknown> = {};
      for (const [k, line] of Object.entries(v)) {
        if (!sameValue(line, (base as Record<string, unknown>)[k])) lines[k] = line;
      }
      if (Object.keys(lines).length > 0) out[key] = lines;
      continue;
    }
    if (!sameValue(v, globalRow[key])) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function loadClinicOverlays(
  clinicId: string | null | undefined,
  entityType: CatalogEntityType,
): Promise<ClinicOverlays> {
  if (!clinicId) return EMPTY_OVERLAYS;
  const rows = await prisma.clinicCatalogOverlay.findMany({
    where: { clinicId, entityType },
    select: { entityCode: true, hideGlobal: true, overridesJson: true },
  });
  const hidden = new Set<string>();
  const overrides = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row.hideGlobal) hidden.add(row.entityCode);
    if (isOverridableEntityType(entityType)) {
      const clean = sanitizeOverrides(entityType, row.overridesJson);
      if (clean) overrides.set(row.entityCode, clean);
    }
  }
  return { hidden, overrides };
}

/**
 * Merge the clinic's override (if any) over a GLOBAL catalog row. Pure.
 * Returns the row unchanged (plus `clinicOverridden: false`) when there is
 * nothing to apply. Caller passes the row's stable code (Drug.id /
 * HandoutTemplate.code / DiagnosisGuide.code).
 */
export function applyClinicOverlay<T extends Record<string, unknown>>(
  row: T,
  code: string,
  overlays: Pick<ClinicOverlays, "overrides">,
  entityType: OverridableEntityType,
): T & { clinicOverridden: boolean } {
  const patch = overlays.overrides.get(code);
  if (!patch) return { ...row, clinicOverridden: false };
  const clean = sanitizeOverrides(entityType, patch);
  if (!clean) return { ...row, clinicOverridden: false };
  const merged = MERGED_OBJECT_FIELDS[entityType] ?? [];
  const out: Record<string, unknown> = { ...row, ...clean };
  for (const key of merged) {
    if (clean[key] === undefined) continue;
    const base = isPlainObject(row[key]) ? row[key] : {};
    out[key] = { ...(base as Record<string, unknown>), ...(clean[key] as object) };
  }
  // A clinic photo alone is not an edit of the catalog text.
  out.clinicOverridden = Object.keys(clean).some((k) => !NON_TEXT_FIELDS.has(k));
  return out as T & { clinicOverridden: boolean };
}

/**
 * G6 helper kept for routes that only need the hide list (labs, protocols).
 */
export async function loadHiddenCodes(
  clinicId: string | null | undefined,
  entityType: CatalogEntityType,
): Promise<Set<string>> {
  if (!clinicId) return new Set();
  const rows = await prisma.clinicCatalogOverlay.findMany({
    where: { clinicId, entityType, hideGlobal: true },
    select: { entityCode: true },
  });
  return new Set(rows.map((r) => r.entityCode));
}
