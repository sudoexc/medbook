import type { Prisma } from "@/generated/prisma/client";

/**
 * The list's order for a column sort (audit PT-17). «Последний визит» is
 * nullable: Postgres puts NULLs first on DESC, so sorting by it showed every
 * patient who never came before the ones seen yesterday. Never-seen
 * patients go last either way. The id tiebreaker keeps cursor paging
 * stable when many rows share a value (the same visit count, the same
 * zero LTV): without it a page could repeat or skip patients.
 */
export function patientListOrderBy(
  sort: "createdAt" | "lastVisitAt" | "visitsCount" | "ltv" | "fullName",
  dir: "asc" | "desc",
): Prisma.PatientOrderByWithRelationInput[] {
  const primary: Prisma.PatientOrderByWithRelationInput =
    sort === "lastVisitAt"
      ? { lastVisitAt: { sort: dir, nulls: "last" } }
      : ({ [sort]: dir } as Prisma.PatientOrderByWithRelationInput);
  return [primary, { id: dir }];
}
