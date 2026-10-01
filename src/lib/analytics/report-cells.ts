/**
 * How a report-builder cell reads on screen, in the CSV and in the PDF
 * (audit AN-09). Client-safe: the builder and the saved-report page render
 * with it, and the server exports use `formatReportDay` for dates.
 *
 * The two pages each had their own copy of the table formatter, and a day
 * printed as the raw `2026-09-22T00:00:00.000Z` the JSON carries.
 */
import { intlLocale, type Locale } from "@/lib/format";
import { tashkentDateOf } from "@/lib/tashkent-time";

export type ReportCellUnit = "count" | "tiins" | "ratio" | "text" | "date";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A report day as ДД.ММ.ГГГГ. The `date` dimension is the Tashkent civil
 * day (dimensions.ts); Postgres hands it back as that day's UTC midnight,
 * which `tashkentDateOf` maps back onto the same day. Null when the value
 * is not a day at all.
 */
export function formatReportDay(value: unknown): string | null {
  let ymd: string | null = null;
  if (typeof value === "string" && YMD.test(value)) {
    ymd = value;
  } else if (value instanceof Date || typeof value === "string") {
    const at = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(at.getTime())) ymd = tashkentDateOf(at);
  }
  const m = ymd ? YMD.exec(ymd) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function formatSoum(tiins: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(tiins / 100));
}

/** On-screen table cell. The header already says «, сум» for money. */
export function formatReportCell(
  value: unknown,
  unit: ReportCellUnit | undefined,
  locale: Locale,
): string {
  if (value === null || value === undefined) return "—";
  if (unit === "date") return formatReportDay(value) ?? String(value);
  if (typeof value === "string") {
    if (unit === "tiins") {
      const n = Number(value);
      if (Number.isFinite(n)) return formatSoum(n, locale);
    }
    return value;
  }
  if (typeof value === "number") {
    if (unit === "tiins") return formatSoum(value, locale);
    if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
    return value.toLocaleString(intlLocale(locale));
  }
  if (typeof value === "bigint") {
    if (unit === "tiins") return formatSoum(Number(value), locale);
    return value.toString();
  }
  return String(value);
}
