/**
 * Times of day read from a dosing text (audit VW-11).
 *
 * A structured prescription row reminds the patient only on the times of day
 * it carries: the finalize bridge turns `timesOfDay` into the reminder
 * schedule and switches reminders on only when there is at least one
 * (`buildBridgeSchedule`, `remindersEnabled`). Every new row used to start
 * with none, so the blue bell promised reminders that never came. A row
 * whose text already says how often («по 1 таблетке 2 раза в день») now
 * starts with the matching slots; a row whose text does not say keeps none,
 * and the bell says there is no schedule instead of pretending.
 *
 * Conservative on purpose: named slots («утром и на ночь») win, then a daily
 * frequency of 1 to 4; anything else (weekly, «через день», ranges above 4,
 * «по требованию», «при боли», «не более 3 раз») gives no slots, because a
 * reminder at a guessed time is worse than none. Pure and client-safe.
 */

export type DosingTimeOfDay = "MORNING" | "NOON" | "EVENING" | "NIGHT";

const ORDER: DosingTimeOfDay[] = ["MORNING", "NOON", "EVENING", "NIGHT"];

/** Slots for «N раз в день». */
const BY_FREQUENCY: Record<number, DosingTimeOfDay[]> = {
  1: ["MORNING"],
  2: ["MORNING", "EVENING"],
  3: ["MORNING", "NOON", "EVENING"],
  4: ["MORNING", "NOON", "EVENING", "NIGHT"],
};

// Named slots, Russian and Uzbek. «натощак» and «после обеда» are meal
// relations, not times; «однократно» is a single dose, not a daily one.
const SLOT_PATTERNS: Array<[DosingTimeOfDay, RegExp]> = [
  ["MORNING", /(^|[^\p{L}])(утром|утро|по утрам|ertalab|ertalabki)(?![\p{L}])/iu],
  [
    "NOON",
    /(^|[^\p{L}])(днём|днем|в обед|в полдень|kunduzi|tushlikda|peshinda)(?![\p{L}])/iu,
  ],
  ["EVENING", /(^|[^\p{L}])(вечером|вечер|по вечерам|kechqurun|kechki)(?![\p{L}])/iu],
  [
    "NIGHT",
    /(^|[^\p{L}])(на ночь|перед сном|ночью|uxlashdan oldin|tunda|kechasi)(?![\p{L}])/iu,
  ],
];

const WORD_COUNTS: Record<string, number> = {
  дважды: 2,
  трижды: 3,
};

/**
 * How many times a day the text says, or null. «2–3 раза в день» reads as 2
 * (the lower bound: never remind more often than prescribed).
 */
export function dailyFrequencyFromText(text: string): number | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  // Not a daily schedule: weekly, every other day, on demand, a condition
  // («при головной боли: …») or a cap («не более / до 3 раз в день»).
  if (
    /(^|[^\p{L}])(в\s+недел|при\s|до\s+\d|не\s+более)|через\s+день|по\s+требовани|по\s+необходимост|haftasiga|haftada|zarur\s+bo/u.test(
      t,
    )
  ) {
    return null;
  }
  // «2 раза в день», «2-3 раза в сутки», «2 р/д», «2р/сут»
  const ru = t.match(
    /(?:^|\D)(\d)\s*(?:[-–—]\s*\d\s*)?(?:раза?|р\.?)\s*(?:в\s+|\/\s*)(?:день|сут(?:ки|ок)?|д(?![\p{L}]))/u,
  );
  if (ru) return Number(ru[1]);
  // «раз в день», «раз в сутки» without a digit
  if (/(?:^|[^\p{L}\d])раз\s+в\s+(?:день|сутки)/u.test(t)) return 1;
  // «дважды в день», «трижды в сутки»
  for (const [word, n] of Object.entries(WORD_COUNTS)) {
    if (t.includes(word)) return n;
  }
  // Uzbek: «kuniga 2 marta», «kunda 2 mahal», «2 mahal»
  const uz = t.match(/(?:kuniga|kunda|sutkada)\s*(\d)\s*(?:marta|mahal)|(\d)\s*mahal/);
  if (uz) return Number(uz[1] ?? uz[2]);
  return null;
}

/**
 * The times of day a dosing text implies, in canonical order, or [] when it
 * does not say. Several texts (dose, instruction, the source line) may be
 * passed; the first that says anything decides.
 */
export function timesOfDayFromText(
  ...texts: ReadonlyArray<string | null | undefined>
): DosingTimeOfDay[] {
  for (const raw of texts) {
    const text = raw?.trim();
    if (!text) continue;
    // An as-needed drug has no schedule, whatever time it names.
    if (/^при\s/i.test(text)) return [];
    const named = ORDER.filter((slot) =>
      SLOT_PATTERNS.some(([s, re]) => s === slot && re.test(text)),
    );
    if (named.length > 0) return named;
    const n = dailyFrequencyFromText(text);
    if (n !== null && BY_FREQUENCY[n]) return [...BY_FREQUENCY[n]];
  }
  return [];
}

/**
 * What the bell on a row means for the patient, the same rule as the
 * finalize bridge: reminders go out only for a row sent to the patient that
 * has at least one time of day.
 */
export function reminderStateOf(row: {
  remindPatient: boolean;
  timesOfDay: readonly string[];
}): "on" | "noTimes" | "off" {
  if (!row.remindPatient) return "off";
  return row.timesOfDay.length > 0 ? "on" : "noTimes";
}
