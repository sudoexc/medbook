/**
 * Phase 19 Wave 3 — invoice number sequencer.
 *
 * Format: `INV-${YYYY}-${zero-padded-counter}` where the counter restarts
 * at 1 every calendar year and is zero-padded to 4 digits (room for
 * 9999 invoices/clinic/year — comfortably above the realistic ceiling).
 *
 * The sequencer is per-clinic per-year so two clinics can both have
 * `INV-2026-0001` (the counter does NOT collide across tenants).
 * Uniqueness is still enforced globally by the `Invoice.number` UNIQUE
 * index in Postgres — the format we emit is unique-by-construction
 * (each tenant's series is monotonically increasing) but the DB-level
 * constraint is the canonical guard against accidental duplicates.
 *
 * `nextInvoiceNumber` runs a `findFirst` on `Invoice` filtered by
 * `clinicId` and the year prefix, ordered by number desc. Parsing the
 * trailing counter from the matched row is cheaper than aggregating the
 * full year's worth of invoices and works fine here because each tenant
 * issues at most ~12 rows per year (one per billing cycle) plus the
 * occasional ad-hoc upgrade invoice.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

/** Pure helper. Format `(year, counter)` → `INV-YYYY-NNNN`. */
export function formatInvoiceNumber(year: number, counter: number): string {
  const yyyy = String(year).padStart(4, "0");
  const nnnn = String(counter).padStart(4, "0");
  return `INV-${yyyy}-${nnnn}`;
}

/**
 * Pure helper. Parse the trailing counter out of an invoice number we
 * previously formatted. Returns `null` if the shape doesn't match (so
 * legacy / hand-mended numbers don't crash the sequencer — they just
 * roll over the next allocation back to 1).
 */
export function parseInvoiceCounter(number: string): number | null {
  const m = /^INV-(\d{4})-(\d{4,})$/.exec(number);
  if (!m) return null;
  const n = parseInt(m[2]!, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the next available invoice number for `(clinicId, year)`.
 *
 * Reads MAX-by-prefix via `findFirst` ordered by `number` desc. The
 * lexicographic sort is correct as long as the counter is zero-padded
 * to a fixed width (it is — see `formatInvoiceNumber`).
 *
 * Race condition: two concurrent callers could both observe the same
 * "highest" row and emit the same number. The race is bounded by the
 * `Invoice.number` UNIQUE index — the second writer will hit a P2002
 * and the caller can retry. We don't paper over it here because invoice
 * issuance is low-throughput (~minutes between rows in practice).
 */
export async function nextInvoiceNumber(
  clinicId: string,
  year: number,
): Promise<string> {
  const prefix = `INV-${String(year).padStart(4, "0")}-`;
  const latest = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.invoice.findFirst({
      where: { clinicId, number: { startsWith: prefix } },
      orderBy: { number: "desc" },
      select: { number: true },
    }),
  );
  const lastCounter = latest ? (parseInvoiceCounter(latest.number) ?? 0) : 0;
  return formatInvoiceNumber(year, lastCounter + 1);
}
