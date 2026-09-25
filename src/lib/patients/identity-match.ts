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
 * «same» puts medical data into a stranger's record.
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

/**
 * True only when the typed identity is very likely the card's owner:
 *   - surnames equal (after alphabet folding), so «Каримов» ≠ «Каримова»;
 *   - both carry a given name and one is a prefix of the other;
 *   - patronymics, when both are present, likewise;
 *   - birth years, when both are known, equal.
 * A surname alone is never enough: relatives share it.
 */
export function samePersonLikely(
  probe: IdentityProbe,
  card: IdentityCard,
): boolean {
  const a = nameTokens(probe.fullName);
  const b = nameTokens(card.fullName);
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0]) return false;
  if (!tokensCompatible(a[1]!, b[1]!)) return false;
  if (a.length >= 3 && b.length >= 3 && !tokensCompatible(a[2]!, b[2]!)) {
    return false;
  }
  const cardYear = birthYearOf(card.birthDate);
  if (probe.birthYear !== null && cardYear !== null && probe.birthYear !== cardYear) {
    return false;
  }
  return true;
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
