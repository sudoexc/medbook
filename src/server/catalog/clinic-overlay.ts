/**
 * Phase G6 / Ф4 — clinic-side overlay for curated catalogs.
 *
 * Two layers, both keyed by (entityType, entityCode):
 *
 *   • hide  — `hideGlobal: true` removes a global row from doctor-facing
 *     search/order surfaces for this clinic (G6 MVP, unchanged).
 *   • override — `overridesJson` (Ф4) is a shallow patch of WHITELISTED
 *     fields merged over the global row at read time. The whitelist is the
 *     contract: anything else in the stored JSON is ignored on read, so a
 *     hand-edited DB row can never inject `id` / `clinicId` / `active`.
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
 * dropped too (an override either sets a field or leaves the global value).
 */
export function sanitizeOverrides(
  entityType: OverridableEntityType,
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed = OVERLAY_FIELD_WHITELIST[entityType] as readonly string[];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const v = (raw as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
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
  return { ...row, ...clean, clinicOverridden: true };
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
