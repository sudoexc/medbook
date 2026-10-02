/**
 * The WHERE for a free-text patient search: name, phone, passport,
 * Telegram username, the card number («P-00125») and the doctor's
 * «Фамилия ГГГГ» habit.
 *
 * The doctor records patients as «Турматов О 1969» and searches the same
 * way. Since the year was lifted out of the name into `birthDate`, a
 * trailing year has to match on the date. The search used to AND that
 * (surname + year) with an OR over the WHOLE term («Турматов 1969» inside
 * the name, or «1969» inside the phone), and Prisma joins sibling AND/OR
 * with AND: a row matched only if its name still carried the year it no
 * longer has, so «Турматов 1969» found nobody and the doctor made a
 * duplicate card (audit PT-03). With a year, every text condition is built
 * from the part before it; the whole term never takes part.
 *
 * One builder for every patient search box (CRM list, the doctor's search
 * and walk-in dialog, «Мои пациенты», the top bar), so the habit works the
 * same everywhere.
 */
import { normalizePhone } from "@/lib/phone";
import { parsePatientNumber } from "@/lib/patient-number";

type Where = Record<string, unknown>;

/** Trailing four-digit year, the way it is typed: «Турматов 1969». */
const TRAILING_YEAR = /(?:^|\s)((?:19|20)\d{2})\s*$/;

/** Nobody alive was born earlier; same floor as `parsePatientIdentity`. */
const MIN_YEAR = 1900;

/**
 * A card number the way staff read it off a card or a printout: «P-00125»,
 * «p125», also with the Cyrillic «Р» a Russian keyboard types in its place.
 * The prefix is required: bare digits are a phone fragment or a year, and
 * matching them against card numbers too would bury those results.
 */
const CARD_NUMBER = /^[PpРр]-?\s*\d{1,9}$/;

/** The card number a term names, or null (audit PT-25). */
export function cardNumberFromTerm(term: string): number | null {
  if (!CARD_NUMBER.test(term)) return null;
  return parsePatientNumber(term.replace(/^[Рр]/, "P").replace(/\s+/g, ""));
}

/** Name, passport, Telegram username and (for 3+ digits) the phone. */
function textConditions(term: string): Where[] {
  const phoneDigits = term.replace(/\D/g, "");
  const phoneNorm = normalizePhone(term);
  const or: Where[] = [
    { fullName: { contains: term, mode: "insensitive" } },
    // `passport` is stored encrypted as «v1:<iv>:<tag>:<ct>», base64 that
    // ILIKE happily matched: «Ali», «ов» or «v1» pulled in random cards
    // and pushed the wanted one out of the doctor's 8 results (audit
    // PT-26). Only legacy plaintext rows can match, and no envelope is
    // without its colons while a passport number never has one. Searching
    // encrypted passports would need a blind-index (HMAC) column, see
    // runbook.
    {
      AND: [
        { passport: { contains: term, mode: "insensitive" } },
        { NOT: { passport: { contains: ":" } } },
      ],
    },
    { telegramUsername: { contains: term, mode: "insensitive" } },
  ];
  if (phoneDigits.length >= 3) {
    or.push({ phone: { contains: term } });
    or.push({ phoneNormalized: { contains: phoneDigits } });
    if (phoneNorm) or.push({ phoneNormalized: { contains: phoneNorm } });
  }
  return or;
}

/**
 * A single condition to put under `AND` next to the caller's other filters,
 * or null for an empty term. `now` bounds the plausible birth year.
 */
export function patientSearchWhere(
  raw: string | null | undefined,
  now: Date = new Date(),
): Where | null {
  const term = (raw ?? "").trim();
  if (!term) return null;

  // «P-00125» names one card. Its digits are not a phone fragment, so the
  // text conditions stay out of it.
  const cardNumber = cardNumberFromTerm(term);
  if (cardNumber !== null) return { patientNumber: cardNumber };

  const yearMatch = term.match(TRAILING_YEAR);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (year === null || year < MIN_YEAR || year > now.getFullYear()) {
    return { OR: textConditions(term) };
  }

  const birthDate = {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
  const namePart = term.slice(0, yearMatch!.index ?? 0).trim();
  if (!namePart) {
    // A bare «1969»: everyone born that year, plus the plain text match
    // (a phone or passport containing those digits).
    return { OR: [...textConditions(term), { birthDate }] };
  }

  return {
    OR: [
      // «Турматов 1969»: the name part AND the birth year, otherwise a
      // query naming someone specific returns everyone born that year.
      { AND: [{ OR: textConditions(namePart) }, { birthDate }] },
      // A card typed before the year was lifted into `birthDate` still
      // carries it inside the name, with no birth date at all.
      {
        AND: [
          { fullName: { contains: namePart, mode: "insensitive" } },
          { fullName: { contains: String(year) } },
        ],
      },
    ],
  };
}
