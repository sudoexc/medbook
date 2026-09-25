/**
 * The WHERE for a free-text patient search: name, phone, passport,
 * Telegram username, and the doctor's «Фамилия ГГГГ» habit.
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

type Where = Record<string, unknown>;

/** Trailing four-digit year, the way it is typed: «Турматов 1969». */
const TRAILING_YEAR = /(?:^|\s)((?:19|20)\d{2})\s*$/;

/** Nobody alive was born earlier; same floor as `parsePatientIdentity`. */
const MIN_YEAR = 1900;

/** Name, passport, Telegram username and (for 3+ digits) the phone. */
function textConditions(term: string): Where[] {
  const phoneDigits = term.replace(/\D/g, "");
  const phoneNorm = normalizePhone(term);
  // `passport` is stored encrypted; `contains` only matches legacy plaintext
  // rows. Searching encrypted passports would need a blind-index (HMAC)
  // column, see runbook.
  const or: Where[] = [
    { fullName: { contains: term, mode: "insensitive" } },
    { passport: { contains: term, mode: "insensitive" } },
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
