/**
 * Formatting helpers for money, dates, phones, and names.
 *
 * Spec: docs/TZ.md §9.4.
 *   - UZS: `1 500 000 сум` (ru) / `1 500 000 so'm` (uz). Grouping with
 *     non-breaking spaces, no kopecks. Amount stored in tiins (×100).
 *   - USD: `$125.50`. Amount stored in cents (×100).
 *   - Dates: short/long/time/relative, via Intl.*.
 *   - Phone: `+998 (90) 123-45-67`.
 *   - Names: `Фамилия И. О.` (short) or `Фамилия Имя Отчество` (full).
 *
 * All functions are pure; no server-only or client-only imports.
 */

export type Locale = "ru" | "uz";
export type Currency = "UZS" | "USD";

/**
 * Map the app's locale to a BCP-47 tag accepted by `Intl.*` / `toLocaleString`.
 * Centralises the `"uz" → "uz-Latn-UZ"` mapping so callers don't hardcode
 * `"ru-RU"` directly (which would format numbers and dates as Russian even
 * when the UI is in Uzbek).
 */
export function intlLocale(locale: Locale | string): string {
  return locale === "uz" ? "uz-Latn-UZ" : "ru-RU";
}

// -----------------------------------------------------------------------------
// Money
// -----------------------------------------------------------------------------

/**
 * Format a money amount stored in the currency's minor units
 * (tiins for UZS, cents for USD).
 *
 * Examples:
 *   formatMoney(150000000, "UZS", "ru") → "1 500 000 сум"
 *   formatMoney(150000000, "UZS", "uz") → "1 500 000 so'm"
 *   formatMoney(12550,     "USD", "ru") → "$125.50"
 */
export function formatMoney(
  amount: number | bigint | null | undefined,
  currency: Currency,
  locale: Locale,
): string {
  if (amount === null || amount === undefined) return "";
  const minor = typeof amount === "bigint" ? Number(amount) : amount;
  if (!Number.isFinite(minor)) return "";

  if (currency === "UZS") {
    const whole = Math.trunc(minor / 100);
    // Use narrow-no-break space (U+202F) for thousands — renders well in UI
    // and matches Intl.NumberFormat output for `ru` and `uz` locales.
    const grouped = formatInteger(whole);
    const unit = locale === "uz" ? "so'm" : "сум";
    return `${grouped} ${unit}`;
  }

  // USD: show cents, $ prefix.
  const dollars = minor / 100;
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  return `${sign}$${abs.toFixed(2)}`;
}

/**
 * Format UZS primary + USD secondary pair. Used on cards where the clinic
 * wants to show "1 500 000 сум ≈ $125.50" with the secondary rendered smaller
 * and grayer by the consumer.
 *
 * `usdAmount` is in cents; pass `null` to skip the secondary line.
 */
export function formatMoneyDual(
  uzsAmount: number | bigint | null | undefined,
  usdAmount: number | bigint | null | undefined,
  locale: Locale,
): { primary: string; secondary: string | null } {
  const primary = formatMoney(uzsAmount, "UZS", locale);
  const secondary =
    usdAmount === null || usdAmount === undefined
      ? null
      : formatMoney(usdAmount, "USD", locale);
  return { primary, secondary };
}

function formatInteger(n: number): string {
  // Use a regex-based grouper with a regular space; we avoid Intl here so
  // the output is deterministic across runtimes and test snapshots.
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n)).toString();
  return sign + abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

export type DateStyle =
  | "short"
  | "long"
  | "time"
  | "relative"
  | "dayMonthTime";

/**
 * Format a date/time value.
 *
 *   short        → "22.04.2026" (ru) / "22.04.2026" (uz)
 *   long         → "22 апреля 2026 г." (ru) / "22-aprel, 2026" (uz-ish)
 *   time         → "14:30"
 *   relative     → "вчера в 14:00" / "kecha soat 14:00 da"
 *   dayMonthTime → "6 июня, 15:45" / "6-iyun, 15:45" — for "uploaded on"
 *                  labels where the year would just be noise.
 */
export function formatDate(
  date: Date | string | number | null | undefined,
  locale: Locale,
  style: DateStyle = "short",
): string {
  if (date === null || date === undefined || date === "") return "";
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return "";

  const tag = intlLocale(locale);

  if (style === "short") {
    return new Intl.DateTimeFormat(tag, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  if (style === "long") {
    return new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  }

  if (style === "time") {
    return new Intl.DateTimeFormat(tag, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }

  if (style === "dayMonthTime") {
    const day = new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "long",
    }).format(d);
    const time = new Intl.DateTimeFormat(tag, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
    return `${day}, ${time}`;
  }

  // relative
  return formatRelative(d, locale);
}

/**
 * Format an ISO/Date timestamp as `dd.mm.yyyy HH:mm` anchored in the clinic's
 * wall-clock (Asia/Tashkent). Use for "generated at" / "expires at" /
 * "last run" labels that should read the same to a receptionist in the
 * clinic and an admin browsing from another timezone.
 */
export function formatClinicDateTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
): string {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tashkent",
  }).format(d);
}

/** Clinic wall-clock. Asia/Tashkent is a fixed UTC+5 (no DST since 1992). */
const CLINIC_TZ = "Asia/Tashkent";

/**
 * The clinic-local civil date (year/month/day) for an instant, as an ordinal
 * day number. We read the date parts in Asia/Tashkent and re-pack them through
 * `Date.UTC` purely to get a stable, DST-free day index for subtraction — the
 * UTC epoch here is an ordinal, not a wall-clock instant.
 */
function clinicDayOrdinal(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000;
}

function formatRelative(d: Date, locale: Locale): string {
  const now = new Date();
  const tag = intlLocale(locale);
  // Anchor the displayed time AND the day-boundary comparison to the clinic's
  // wall-clock. Without `timeZone`, both read the runtime zone (UTC on the
  // server), so a late-evening Tashkent event renders an hour-shifted time and
  // can land in the wrong «сегодня / вчера / завтра» bucket under SSR.
  const time = new Intl.DateTimeFormat(tag, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: CLINIC_TZ,
  }).format(d);

  const dayDiff = clinicDayOrdinal(d) - clinicDayOrdinal(now);

  if (dayDiff === 0) {
    return locale === "uz" ? `bugun ${time} da` : `сегодня в ${time}`;
  }
  if (dayDiff === -1) {
    return locale === "uz" ? `kecha ${time} da` : `вчера в ${time}`;
  }
  if (dayDiff === 1) {
    return locale === "uz" ? `ertaga ${time} da` : `завтра в ${time}`;
  }

  // Fallback: Intl.RelativeTimeFormat for days within a week, else absolute.
  if (Math.abs(dayDiff) < 7) {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    return `${rtf.format(dayDiff, "day")}, ${time}`;
  }

  // Absolute fallback — also clinic-anchored so the long date can't drift to
  // the UTC day for events near midnight.
  const longDate = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: CLINIC_TZ,
  }).format(d);
  return `${longDate}, ${time}`;
}

// -----------------------------------------------------------------------------
// Phone
// -----------------------------------------------------------------------------

/**
 * Format an Uzbek phone number for display: `+998 (90) 123-45-67`.
 *
 * Accepts any input (spaces, dashes, parens), extracts digits, normalises
 * common shapes (9 digits → assume +998 prefix; 12 digits starting with 998).
 * Falls back to raw "+digits" if the shape is unfamiliar.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";

  // Normalise to 12 digits starting with 998 when possible.
  if (digits.length === 9 && digits.startsWith("9")) digits = "998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) {
    const cc = digits.slice(0, 3);
    const op = digits.slice(3, 5);
    const a = digits.slice(5, 8);
    const b = digits.slice(8, 10);
    const c = digits.slice(10, 12);
    return `+${cc} (${op}) ${a}-${b}-${c}`;
  }

  // Unknown shape — return canonical "+digits" without breaking.
  return "+" + digits;
}

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

export type NameStyle = "short" | "full";

/**
 * Compose a person name.
 *
 *   short → "Фамилия И. О."   (last + initial of first + initial of patronymic)
 *   full  → "Фамилия Имя Отчество"
 *
 * All parts are optional; missing pieces are skipped gracefully.
 */
export function formatName(
  first?: string | null,
  last?: string | null,
  patronymic?: string | null,
  style: NameStyle = "full",
): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const p = (patronymic ?? "").trim();

  if (style === "short") {
    const parts: string[] = [];
    if (l) parts.push(l);
    if (f) parts.push(f[0]!.toUpperCase() + ".");
    if (p) parts.push(p[0]!.toUpperCase() + ".");
    return parts.join(" ");
  }

  return [l, f, p].filter(Boolean).join(" ");
}

/**
 * Legacy helper: return initials for a space-separated full name.
 * "Иванов Иван Иванович" → "Иванов И. И."
 *
 * Kept for the TV/queue screens that receive a pre-composed fullName string
 * from the DB. Prefer `formatName(first, last, patronymic, "short")` for new
 * code that has the parts separately.
 */
export function initials(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const [surname, ...rest] = parts;
  return `${surname} ${rest.map((p) => p[0]!.toUpperCase() + ".").join(" ")}`;
}
