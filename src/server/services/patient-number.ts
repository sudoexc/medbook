/**
 * Atomic per-clinic patient-number allocator.
 *
 * Backed by `Clinic.patientCounter`. We do a single `UPDATE … RETURNING`
 * (Prisma turns this into one round trip via `update({...select})`) so two
 * concurrent registrations on the same clinic each get distinct numbers
 * without any application-level locking.
 *
 * Pass `tx` when you need the allocation to roll back with the Patient
 * insert — e.g. inside `prisma.$transaction(async (tx) => {...})`. The
 * default falls back to the top-level prisma client when caller is not
 * already inside a transaction.
 */
import { prisma } from "@/lib/prisma";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function allocatePatientNumber(
  clinicId: string,
  client: PrismaLike = prisma,
): Promise<number> {
  const result = await client.clinic.update({
    where: { id: clinicId },
    data: { patientCounter: { increment: 1 } },
    select: { patientCounter: true },
  });
  return result.patientCounter;
}
