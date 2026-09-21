/**
 * Extract prescriptions from free-text conclusion lines.
 *
 * The real doctor writes the whole visit as prose — «Мидокалм (толперизон)
 * 150 мг — по 1 таблетке 2–3 раза в день, курс 10 дней.» — and leaves the
 * structured constructor empty, which silently disables drug-interaction
 * checks, patient reminders and the Telegram medication card. This parser
 * meets the doctor where they already are: it recognises prescription-shaped
 * lines in the text and offers them as one-click structured rows.
 *
 * Deliberately conservative: a false negative costs one manual click, a
 * false positive puts a non-drug into the patient's medication plan. Every
 * heuristic below leans toward "skip when unsure".
 */

export type ParsedMealRelation =
  | "BEFORE_MEAL"
  | "WITH_MEAL"
  | "AFTER_MEAL"
  | "EMPTY_STOMACH"
  | "NO_MATTER";

export type ParsedPrescription = {
  /** Drug name as written, parenthesised synonym preserved. */
  displayName: string;
  /** Strength like «150 мг», null when the line names no dose. */
  strength: string | null;
  /** The instruction tail, cleaned of the course clause. */
  instruction: string | null;
  /** Days parsed from «курс 10 дней» / «курс 1 месяц» / «не более 5 дней». */
  durationDays: number | null;
  mealRelation: ParsedMealRelation;
  /** The exact source line — lets the UI show provenance and dedup. */
  sourceLine: string;
};

// Lines that start like actions/referrals, not medications. A prescription
// line starts with the drug name; these starters mean the sentence is about
// something else even if a dose-like number appears later.
const NON_DRUG_STARTERS =
  /^(рекомендовано|рекомендуется|рекомендую|назначено обследование|контроль|явка|повторн|консультация|направлен|провести|проведение|выполнить|сдать|анализ|осмотр|наблюдение|режим|диета|соблюдать|соблюдение|избегать|ограничить|ограничение|снижение|исключить|продолжить|вести|ведение|использовать|измер|пить|спать|гулять|прогулк|при\s|вечером|утром|днём|днем|на ночь|мрт|кт|ээг|рэг|экг|узи|узд[гс]?|рентген|доппл|лфк|массаж|физиотерап|жалоб|анамнез|объективн|диагноз|обследован|заключени|status)/i;

// Section headers that PREFIX a prescription line («Лечение: Мидокалм…»).
// The header is stripped and the remainder re-parsed — this is the single
// most common way the doctor writes a prescription, so skipping the whole
// line would lose the real drug.
const SECTION_HEADER_RE =
  /^(лечение|терапия|назначения|назначено|медикаментозно(?:е лечение)?)\s*:\s*/i;

// PRN style: «При головной боли — Нурофен по 1 таблетке…». The condition
// moves into the instruction, the capitalised token after the dash is the
// drug.
const PRN_RE =
  /^([Пп]ри\s[^—–:]{2,50}?)\s*[—–:-]\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яё0-9-]{2,40})\s+(.{3,})$/u;

// The instruction tail must look like a dosing schedule for a no-dose line
// to count as a drug («Магне В6 — по 2 таблетки…»). Without this, any
// «Название — пояснение» sentence would become a medication.
// NB: no `\b` anywhere — JS word boundaries are ASCII-only and silently
// never match next to Cyrillic letters.
const SCHEDULE_MARKERS =
  /(по\s+\d|по\s+одн|таблет|капсул|пакетик|ампул|свеч|капл[ияе]|рассасыва|разжёвыва|разжевыва|внутримышечно|внутривенно|подкожно|внутрь|раза?\s+в\s+(?:день|сутки|неделю)|утром|на ночь|перед сном)/i;

// Cyrillic-safe boundary: the unit must not be followed by another letter
// («мг» yes, «мгновенно» no).
const DOSE_RE =
  /(\d+(?:[.,]\d+)?)\s*(мг|мкг|мл|г|МЕ|ЕД)(?=[^а-яёa-z0-9]|$)/iu;

// «Название [синоним] [доза] — хвост». The dash may be typed as —, –, -
// or the doctor may use a colon.
const LINE_RE = /^\s*([A-ZА-ЯЁ][^—–:]{1,70}?)\s*[—–:-]\s+(.{3,})$/u;

// Dash-less fallback: «Мидокалм 150 мг по 1 таблетке…» — the dose anchors
// the split between name and instruction.
const DOSE_SPLIT_RE =
  /^([A-ZА-ЯЁ][^,]{1,60}?\d+(?:[.,]\d+)?\s*(?:мг|мкг|мл|г|МЕ|ЕД))\s+(.{3,})$/iu;

// Strength-less lines need dosing-FORM evidence, not just a time of day —
// «Вечером — тёплая ванна перед сном» must never become a medication.
const STRONG_FORM_MARKERS =
  /(по\s+\d|по\s+одн|таблет|капсул|пакетик|ампул|свеч|капл[ияе]|рассасыва|разжёвыва|разжевыва|внутримышечно|внутривенно|подкожно|внутрь)/i;

function parseDuration(tail: string): {
  durationDays: number | null;
  cleaned: string;
} {
  // «курс 10 дней», «курс 1 месяц», «курсом 2 недели», «не более 5 дней»
  const m = tail.match(
    /(?:,\s*)?(?:курс(?:ом)?|в течение|не более)\s+(\d+)\s*(дн|нед|мес)[а-яё.]*/iu,
  );
  if (!m) return { durationDays: null, cleaned: tail };
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  // Clamp to the server schema's max (365) — one «курс 18 месяцев» line
  // must not 400 the whole replace-all adopt payload.
  const days = Math.min(
    365,
    unit.startsWith("нед") ? n * 7 : unit.startsWith("мес") ? n * 30 : n,
  );
  // «не более N дней» is a cap, not a course — keep it in the instruction
  // text but still surface the number as the duration.
  const isCap = /не более/i.test(m[0]);
  const cleaned = isCap ? tail : tail.replace(m[0], "").trim();
  return { durationDays: days, cleaned };
}

function parseMeal(tail: string): ParsedMealRelation {
  if (/натощак/i.test(tail)) return "EMPTY_STOMACH";
  if (/после еды/i.test(tail)) return "AFTER_MEAL";
  if (/до еды|перед едой/i.test(tail)) return "BEFORE_MEAL";
  if (/во время еды|с едой/i.test(tail)) return "WITH_MEAL";
  return "NO_MATTER";
}

function tidy(s: string): string {
  return s
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;.–—-]+|[\s,;]+$/g, "")
    .replace(/\.$/, "")
    .trim();
}

export function parseConclusionPrescriptions(
  body: string | null | undefined,
): ParsedPrescription[] {
  if (!body) return [];
  const out: ParsedPrescription[] = [];
  const seen = new Set<string>();

  for (const raw of body.split(/\n+/)) {
    let line = raw.trim();
    if (line.length < 8 || line.length > 400) continue;

    // «Лечение: Мидокалм…» — strip the section header, keep the payload.
    const header = SECTION_HEADER_RE.exec(line);
    if (header) line = line.slice(header[0].length).trim();
    if (line.length < 8) continue;

    // PRN: «При головной боли — Нурофен по 1 таблетке…» — the drug is the
    // capitalised token after the dash, the condition joins the instruction.
    let name: string;
    let tail: string;
    const prn = PRN_RE.exec(line);
    if (prn) {
      name = tidy(prn[2]!);
      tail = `${prn[1]!.trim().toLowerCase()}: ${prn[3]!.trim()}`;
      if (!STRONG_FORM_MARKERS.test(tail)) continue;
    } else {
      if (NON_DRUG_STARTERS.test(line)) continue;
      const m = LINE_RE.exec(line) ?? DOSE_SPLIT_RE.exec(line);
      if (!m) continue;
      name = tidy(m[1]!);
      tail = m[2]!.trim();
    }

    // Pull the strength off the end of the name part («Мидокалм … 150 мг»).
    let strength: string | null = null;
    const dose = DOSE_RE.exec(name);
    if (dose && name.toLowerCase().endsWith(dose[0].toLowerCase())) {
      strength = `${dose[1]!.replace(",", ".")} ${dose[2]!.toLowerCase()}`;
      name = tidy(name.slice(0, name.length - dose[0].length));
    }

    // Strength-less lines need dosing-FORM evidence («по 2 таблетки»); a
    // time of day alone is how lifestyle advice is written. With a dose the
    // weaker schedule markers suffice («Депакин 500 мг — утром и вечером»).
    if (!strength && !STRONG_FORM_MARKERS.test(tail)) continue;
    if (!SCHEDULE_MARKERS.test(tail)) continue;

    // Name sanity: 2–60 chars, at most 5 words, starts with a letter, and
    // is not itself a schedule fragment (defends against «По 1 таблетке —…»).
    if (name.length < 2 || name.length > 60) continue;
    if (name.split(/\s+/).length > 5) continue;
    if (!/^[A-Za-zА-ЯЁа-яё]/u.test(name)) continue;
    if (/^по\b/i.test(name) || NON_DRUG_STARTERS.test(name)) continue;

    const { durationDays, cleaned } = parseDuration(tail);
    const key = name.toLowerCase().replace(/\s*\(.*\)\s*/g, "").trim();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      displayName: name,
      strength,
      instruction: tidy(cleaned) || null,
      durationDays,
      mealRelation: parseMeal(tail),
      sourceLine: line,
    });
  }
  return out;
}

/**
 * Candidates not already covered by structured rows or legacy chip lines.
 * Matching is by normalised name containment either way — «Мидокалм
 * (толперизон)» matches an existing «Мидокалм 150 мг» row.
 */
export function unadoptedCandidates(
  parsed: ParsedPrescription[],
  existingNames: string[],
): ParsedPrescription[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // Whole-first-word equality, not substring containment: an existing
  // «Магнерот» must not suppress a parsed «Магне В6».
  const existingHeads = new Set(
    existingNames.map((e) => norm(e).split(" ")[0]).filter(Boolean),
  );
  return parsed.filter((p) => {
    const head = norm(p.displayName).split(" ")[0]!;
    return !existingHeads.has(head);
  });
}
