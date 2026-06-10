/**
 * Atomic per-clinic document-number allocator ("NF-2026-000123").
 *
 * Backed by `DocumentCounter` rows keyed (clinicId, year, kind). Allocation
 * is two race-safe statements:
 *   1. `createMany(skipDuplicates)` — INSERT … ON CONFLICT DO NOTHING seeds
 *      the row for a new (clinic, year, kind) without read-then-write races.
 *   2. `update({ value: { increment: 1 } })` — single UPDATE … RETURNING, so
 *      two concurrent finalizes each get distinct values (same guarantee as
 *      allocatePatientNumber).
 *
 * Pass `tx` so the allocation rolls back together with the finalize write —
 * an aborted finalize must not burn a number.
 */
import { prisma } from "@/lib/prisma";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Derive a number prefix from the clinic slug when `documentNumberPrefix` is
 * not configured: "neuro-fax" → "NF", "neurofax" → "NEUROFAX" (capped at 10).
 */
export function deriveNumberPrefix(slug: string): string {
  const parts = slug.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((p) => p[0]!.toUpperCase()).join("").slice(0, 10);
  }
  return (parts[0] ?? "DOC").toUpperCase().slice(0, 10);
}

export function formatDocumentNumber(
  prefix: string,
  year: number,
  value: number,
): string {
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

export async function allocateDocumentNumber(
  clinicId: string,
  kind: string,
  client: PrismaLike = prisma,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();

  await client.documentCounter.createMany({
    data: [{ clinicId, year, kind, value: 0 }],
    skipDuplicates: true,
  });
  const counter = await client.documentCounter.update({
    where: { clinicId_year_kind: { clinicId, year, kind } },
    data: { value: { increment: 1 } },
    select: { value: true },
  });

  const clinic = await client.clinic.findUnique({
    where: { id: clinicId },
    select: { slug: true, documentNumberPrefix: true },
  });
  const prefix =
    clinic?.documentNumberPrefix?.trim() || deriveNumberPrefix(clinic?.slug ?? "");

  return formatDocumentNumber(prefix, year, counter.value);
}
