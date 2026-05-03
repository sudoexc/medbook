/**
 * Cyrillic → Latin transliteration tailored for Uzbekistan: Russian + Uzbek
 * (both Cyrillic and Latin variants). Output is forced into the slug shape
 * accepted by the API: lowercase Latin, digits, hyphens. Anything else
 * (apostrophes, punctuation, whitespace) collapses to a single hyphen.
 */
const MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  // Uzbek-Cyrillic extras.
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

export function slugify(input: string, maxLen = 60): string {
  const lower = input.toLowerCase();
  let out = "";
  for (const ch of lower) out += MAP[ch] ?? ch;
  return out
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}
