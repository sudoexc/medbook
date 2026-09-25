/**
 * «Is the person at the desk the one this card belongs to?» A phone number
 * cannot answer that on its own (audit Q-03): a mother brings her son and
 * gives her own number, and the old walk-in path silently wrote the boy's
 * visit, diagnosis and prescriptions into her card.
 *
 * So when a typed number already belongs to a card, the typed name (and the
 * birth year the doctor habitually appends) is compared with that card
 * before the visit is attached. The comparison is deliberately strict:
 * a false «different» only costs staff one confirmation click, while a false
 * «same» puts medical data into a stranger's record. Hence initials and a
 * birth year known on one side only never count as a match.
 *
 * Pure module, shared by the server (walk-in resolution) and tests.
 */
import { parsePatientIdentity } from "./parse-identity";

/** What staff / the kiosk typed. */
export interface IdentityProbe {
  fullName: string;
  birthYear: number | null;
}

/** What the card already holds. */
export interface IdentityCard {
  fullName: string;
  birthDate: Date | string | null;
}

// Uzbek and Russian names reach us in both alphabets («Каримова» at the desk,
// «Karimova» from a phone keyboard). Folding everything to one Latin skeleton
// lets those compare equal. Multi-letter results follow Uzbek Latin, which is
// what patients type.
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh",
  щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

/** One name token folded to lowercase Latin letters only. */
export function foldNameToken(token: string): string {
  const lower = token.toLowerCase();
  let out = "";
  for (const ch of lower) out += CYR_TO_LAT[ch] ?? ch;
  // Russian-style romanisation of the same sounds.
  out = out.replace(/kh/g, "x").replace(/zh/g, "j");
  // Apostrophes (o', g'), dots after initials, hyphens, digits: all noise.
  return out.replace(/[^a-z]/g, "");
}

/** Name → folded tokens, surname first (the clinic's writing order). */
export function nameTokens(fullName: string): string[] {
  return fullName
    .split(/\s+/)
    .map(foldNameToken)
    .filter((t) => t.length > 0);
}

/** Calendar year of a stored birth date (stored as UTC midnight). */
export function birthYearOf(value: Date | string | null): number | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? null : d.getUTCFullYear();
}

/** An initial matches the full name it abbreviates: «О» ~ «Олим». */
function tokensCompatible(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** A name token and whether it was written as an initial («Т», «Т.»). */
type NamePart = { folded: string; initial: boolean };

function nameParts(fullName: string): NamePart[] {
  const parts: NamePart[] = [];
  for (const raw of fullName.split(/\s+/)) {
    const folded = foldNameToken(raw);
    if (!folded) continue;
    // Counted before folding: «Ш» folds to two Latin letters, yet it is one
    // written letter. A trailing dot marks «Sh.» as an initial too.
    const letters = raw.replace(/[^\p{L}]/gu, "").length;
    parts.push({ folded, initial: letters <= 1 || /\.$/.test(raw) });
  }
  return parts;
}

/**
 * The same two names, written out? Surname, then given name, then
 * patronymic (the clinic's writing order):
 *   - surnames equal after alphabet folding, so «Каримов» ≠ «Каримова»;
 *   - given names BOTH written in full and equal. An initial fits the whole
 *     family: «Каримов Т» is Тахир the father and Тимур the son alike;
 *   - patronymics, when both are present, compatible (an initial may stand
 *     for the other): the given name already told siblings apart.
 * A surname alone is never enough: relatives share it.
 */
export function sameNameLikely(a: string, b: string): boolean {
  const x = nameParts(a);
  const y = nameParts(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x[0]!.initial || y[0]!.initial || x[0]!.folded !== y[0]!.folded) {
    return false;
  }
  if (x[1]!.initial || y[1]!.initial || x[1]!.folded !== y[1]!.folded) {
    return false;
  }
  if (
    x.length >= 3 &&
    y.length >= 3 &&
    !tokensCompatible(x[2]!.folded, y[2]!.folded)
  ) {
    return false;
  }
  return true;
}

/**
 * True only when the typed identity is very likely the card's owner: the
 * names match (see `sameNameLikely`) and so do the birth years. A year
 * known on one side only is «not sure», not «same»: the father's card
 * without a date and his namesake son typed «2012» look identical
 * otherwise. «Not sure» makes staff confirm, which is the point.
 */
export function samePersonLikely(
  probe: IdentityProbe,
  card: IdentityCard,
): boolean {
  if (!sameNameLikely(probe.fullName, card.fullName)) return false;
  const cardYear = birthYearOf(card.birthDate);
  if ((probe.birthYear === null) !== (cardYear === null)) return false;
  return probe.birthYear === cardYear;
}

/**
 * A name in the clinic's order and in the «given name first» order a
 * Telegram profile uses («Dilnoza Karimova» → «Karimova Dilnoza»), so one
 * person written both ways still compares equal.
 */
export function nameOrders(fullName: string): string[] {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [fullName.trim()];
  const lastFirst = [words[words.length - 1]!, ...words.slice(0, -1)].join(" ");
  return [words.join(" "), lastFirst];
}

/**
 * Convenience for callers holding the raw typed string («Каримов Т 2012»):
 * lifts the year out the same way patient creation does.
 */
export function probeFromTyped(raw: string, today?: Date): IdentityProbe {
  const parsed = parsePatientIdentity(raw, today);
  return {
    fullName: parsed.fullName || raw.trim(),
    birthYear: parsed.birthYear,
  };
}
