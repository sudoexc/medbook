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

export type DateStyle = "short" | "long" | "time" | "relative";

/**
 * Format a date/time value.
 *
 *   short    → "22.04.2026" (ru) / "22.04.2026" (uz)
 *   long     → "22 апреля 2026 г." (ru) / "22-aprel, 2026" (uz-ish)
 *   time     → "14:30"
 *   relative → "вчера в 14:00" / "kecha soat 14:00 da"
 */
export function formatDate(
  date: Date | string | number | null | undefined,
  locale: Locale,
  style: DateStyle = "short",
): string {
  if (date === null || date === undefined || date === "") return "";
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return "";

  const intlLocale = locale === "uz" ? "uz-Latn-UZ" : "ru-RU";

  if (style === "short") {
    return new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  }

  if (style === "long") {
    return new Intl.DateTimeFormat(intlLocale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  }

  if (style === "time") {
    return new Intl.DateTimeFormat(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }

  // relative
  return formatRelative(d, locale);
}

function formatRelative(d: Date, locale: Locale): string {
  const now = new Date();
  const intlLocale = locale === "uz" ? "uz-Latn-UZ" : "ru-RU";
  const time = new Intl.DateTimeFormat(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

  // Compare at day granularity (local time).
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(d) - startOfDay(now)) / (1000 * 60 * 60 * 24),
  );

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
    const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
    return `${rtf.format(dayDiff, "day")}, ${time}`;
  }

  return `${formatDate(d, locale, "long")}, ${time}`;
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
