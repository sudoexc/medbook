/**
 * Phase 18 Wave 3 — CSV serialiser for the report-builder export.
 *
 * Pure-function string builder (no streaming primitives) — the runner caps
 * rows at 1000 and Excel-friendly UTF-8 BOM up front means we have to
 * materialise the whole document anyway.
 *
 * Why the BOM: Excel on Windows still defaults to a non-UTF-8 codepage when
 * opening .csv. A leading `﻿` flips it to UTF-8 so Cyrillic and Latin-Uz
 * apostrophes round-trip without garbling.
 *
 * Why numbers stay unformatted: the spec demands raw numerics for currency
 * cells (`123456.78` not `123 456,78 UZS`) so Excel treats them as numbers
 * the user can SUM/AVG over. The pretty rendering happens in the on-screen
 * table; CSV is data, not display.
 */

export interface CsvColumn {
  /** Internal column key — e.g. the dimension/measure alias. */
  key: string;
  /** Header label written into the first row (already-localised). */
  label: string;
  /** Hint for cell rendering. */
  unit?: "count" | "tiins" | "ratio" | "text";
}

export type CsvRow = Record<string, unknown>;

const BOM = "﻿";

function quoteIfNeeded(raw: string): string {
  if (
    raw.includes(",") ||
    raw.includes("\"") ||
    raw.includes("\n") ||
    raw.includes("\r")
  ) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function tiinsToSoumString(tiins: bigint | number): string {
  // Convert to soum with two-decimal precision, no thousands separator.
  // BigInt path keeps precision for big revenues; number path is fine for
  // smaller measures (avg ticket can fit in number).
  if (typeof tiins === "bigint") {
    const ZERO = BigInt(0);
    const HUNDRED = BigInt(100);
    const sign = tiins < ZERO ? "-" : "";
    const abs = tiins < ZERO ? -tiins : tiins;
    const major = abs / HUNDRED;
    const minor = abs % HUNDRED;
    return `${sign}${major.toString()}.${minor.toString().padStart(2, "0")}`;
  }
  if (!Number.isFinite(tiins)) return "0";
  return (tiins / 100).toFixed(2);
}

function formatCell(value: unknown, unit: CsvColumn["unit"]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") {
    if (unit === "tiins") return tiinsToSoumString(value);
    return value.toString();
  }
  if (typeof value === "number") {
    if (unit === "tiins") return tiinsToSoumString(value);
    if (unit === "ratio") return value.toString();
    if (Number.isInteger(value)) return value.toString();
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Build a CSV document body from a column descriptor + row array.
 * The output starts with a UTF-8 BOM, header row, then data rows. Lines
 * are CRLF-terminated per RFC 4180. Returns a single string — the route
 * handler streams it via `Response.body`.
 */
export function formatCsv(
  columns: ReadonlyArray<CsvColumn>,
  rows: ReadonlyArray<CsvRow>,
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => quoteIfNeeded(c.label)).join(","));
  for (const row of rows) {
    const cells = columns.map((c) =>
      quoteIfNeeded(formatCell(row[c.key], c.unit)),
    );
    lines.push(cells.join(","));
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Build a `<name>-YYYY-MM-DD.csv` filename. Strips characters that would
 * confuse Content-Disposition; falls back to `report` when name is empty.
 */
export function csvFilename(name: string, now: Date = new Date()): string {
  const safe =
    name
      .trim()
      .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "report";
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${safe}-${yyyy}-${mm}-${dd}.csv`;
}
