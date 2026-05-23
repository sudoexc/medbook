/**
 * Shared types + helpers for Action Center detectors (Phase 13 Wave 2).
 *
 * Each detector exports a pure async function:
 *
 *   detect<Type>(prisma, clinicId, now, config) → ActionPayload[]
 *
 * The `PrismaLike` type below is intentionally loose: detectors only ever do
 * read operations (`findMany`, `findUnique`, `groupBy`, `count`), so we accept
 * either the real `TenantScopedPrisma` import or a structural mock from tests.
 * The engine wraps every call inside `runWithTenant({ kind: "TENANT", ... })`,
 * so when the real client is passed the tenant-scope extension still does its
 * job — detectors never need to filter by `clinicId` themselves for
 * tenant-scoped models.
 *
 * Detectors round any floating-point payload values they emit (e.g. risk
 * scores) before constructing the payload so the dedupeKey + payload diff
 * stay stable across recompute passes — see Wave 1 hand-off notes about the
 * no-op gate inside `upsertAction`.
 */

import type { TenantScopedPrisma } from "@/lib/prisma";

/**
 * Subset of the tenant-scoped client we accept everywhere. Previously a
 * `TenantScopedPrisma | PrismaClient` union to "allow mocks", but the union
 * confused TS's overload resolution for extended-client methods (TS2349
 * "expression is not callable"). Tests pass `as never` structural mocks
 * anyway, so the union bought nothing — narrowed to the extended type.
 */
export type PrismaLike = TenantScopedPrisma;

/** Round `n` to `digits` decimal places. Stable for dedupe key churn. */
export function round(n: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** Floor `d` to the start of its UTC day. */
export function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

/** Add `days` days (24h each) to `d` and return a new Date. */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Add `hours` to `d` and return a new Date. */
export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 60 * 60 * 1000);
}

/** Add `minutes` to `d`. */
export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60 * 1000);
}
