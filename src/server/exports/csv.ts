/**
 * CSV cells for every staff export (audit PT-19, INF-02).
 *
 * - RFC 4180 quoting (commas, quotes, line breaks).
 * - Formula injection: a cell that opens with `=`, `+`, `-`, `@`, a tab or
 *   a carriage return is run as a formula by Excel and LibreOffice. A
 *   patient's name comes from their Telegram profile, so «=HYPERLINK(...)»
 *   typed there executed on the admin's PC when the file was opened. Such a
 *   cell gets a leading apostrophe. A plain number or phone («+998 90 ...»,
 *   «-150000») is left alone: it holds no reference or function, and an
 *   apostrophe would break every phone column.
 * - Money: amounts are stored in тийин (and USD in cents); the files used to
 *   carry those raw, «15000000» for 150 000 сум. `moneyCell` writes the
 *   amount in сум (or dollars), with no decimals when they are zero.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
/** Digits with the separators a phone or a signed amount uses. */
const PLAIN_NUMBER = /^[+-]?\d[\d\s().-]*$/;

/** Neutralise a value spreadsheet software would evaluate. */
export function neutralizeFormula(s: string): string {
  if (!FORMULA_START.test(s)) return s;
  if (PLAIN_NUMBER.test(s)) return s;
  return `'${s}`;
}

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join("|")
        : String(value);
  const s = neutralizeFormula(raw);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Minor units (тийин, cents) as major units: 15000000 → "150000". */
export function moneyCell(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  const whole = Math.trunc(minor);
  return whole % 100 === 0 ? String(whole / 100) : (whole / 100).toFixed(2);
}

export function csvHeader(cols: readonly string[]): string {
  return cols.join(",") + "\n";
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",") + "\n";
}
