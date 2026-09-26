/**
 * Clinic-wide lookups for `Doctor.ticketPrefix` (audit Q-12). The pure rules
 * (alphabet, validation, next free letter, the printed format) live in
 * `@/server/services/ticket-number`; this file only reads what is taken.
 */
import { prisma } from "@/lib/prisma";
import { nextTicketPrefix } from "@/server/services/ticket-number";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Every letter already held in the clinic, with its doctor.
 *
 * Read through the Clinic row on purpose. A top-level Doctor query in a
 * branch-scoped request is narrowed to that branch by the tenant extension,
 * but the letter has to be unique across the whole clinic (the unique index
 * is on clinicId + ticketPrefix): a letter taken in another branch would
 * look free and the write would then fail on the index.
 */
export async function takenTicketPrefixes(
  db: PrismaLike,
  clinicId: string,
): Promise<Array<{ id: string; ticketPrefix: string }>> {
  const clinic = await db.clinic.findUnique({
    where: { id: clinicId },
    select: {
      doctors: {
        where: { ticketPrefix: { not: null } },
        select: { id: true, ticketPrefix: true },
      },
    },
  });
  return (clinic?.doctors ?? []).flatMap((d) =>
    d.ticketPrefix ? [{ id: d.id, ticketPrefix: d.ticketPrefix }] : [],
  );
}

/** The letter a new doctor of this clinic gets by default. */
export async function nextFreeTicketPrefix(
  db: PrismaLike,
  clinicId: string,
): Promise<string> {
  const taken = await takenTicketPrefixes(db, clinicId);
  return nextTicketPrefix(taken.map((t) => t.ticketPrefix));
}

/**
 * True when a write failed on the clinic-unique ticket letter. The message
 * shape differs between the classic engine («fields: (`clinicId`,
 * `ticketPrefix`)») and the pg driver adapter (constraint name), and both
 * name the column, so match on it.
 */
export function isTicketPrefixConflict(e: unknown): boolean {
  const x = e as { code?: string; message?: string; meta?: unknown } | null;
  if (!x || x.code !== "P2002") return false;
  let meta = "";
  try {
    meta = JSON.stringify(x.meta ?? {});
  } catch {
    // Circular meta: fall back to the message alone.
  }
  return `${x.message ?? ""} ${meta}`.includes("ticketPrefix");
}
