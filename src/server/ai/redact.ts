/**
 * Phase 15 Wave 1 — PII redaction for LLM prompts.
 *
 * `redact(input)` scrubs phone numbers, passport / JSHSHIR ids, and email
 * addresses out of free-text prompts. `redactWithKnownNames(input, names)`
 * additionally swaps every occurrence of the supplied patient/doctor names
 * with `<NAME_N>` tokens. We deliberately do NOT heuristic-match names
 * without a list — the false-positive rate on Russian/Uzbek prose
 * (capitalized words at sentence starts, place names, drug brands) is too
 * high to justify the recall gain. The repo always has the patient and
 * doctor records in the request scope, so the caller can pass the right
 * names down.
 *
 * `unredact(redacted, replacements)` is the inverse: substitute every
 * `<KIND_N>` token back with its original text. The contract:
 *
 *   redact(s) → { redacted, replacements }
 *   unredact(redacted, replacements) === s   (byte-for-byte)
 *
 * The pair is round-trip stable for any input — see
 * `tests/unit/ai-redact.test.ts`.
 *
 * What we do NOT redact:
 *   • medical terms, drug names, dosages ("500mg", "Trizolinum 5mg")
 *   • diagnoses, ICD codes
 *   • dates ("12.04.2026", "2026-05-06"), times ("14:30")
 *   • prices ("1 500 000 сум")
 *
 * Those are signal the LLM needs to do its job and aren't PII per se.
 */

export type RedactionKind = "NAME" | "PHONE" | "PASSPORT" | "EMAIL";

export type RedactionReplacement = {
  /** The placeholder token (e.g. `<PHONE_1>`). */
  token: string;
  /** The original substring this token replaces. */
  original: string;
  kind: RedactionKind;
};

export type RedactionResult = {
  redacted: string;
  replacements: RedactionReplacement[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Regexes. Tuned for high recall on UZ data; kept narrow enough not to swallow
// medical numerics. See ai-redact.test.ts for the corpus.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phone matcher (compose-of-alternatives).
 *
 * Required to catch all of:
 *   +998 90 123 45 67   (UZ, spaced)
 *   +998901234567       (UZ, no separators)
 *   +998-90-123-45-67   (UZ, dashed)
 *   998 90 123 45 67    (UZ, no plus)
 *   +1-555-0123         (international short)
 *   (90) 123-45-67      (parenthetical local)
 *   90.123.45.67        (UZ-mobile dotted)
 *   tel:+998901234567   (URI form)
 *
 * Must NOT match:
 *   12.04.2026          (date)
 *   12:30               (time)
 *   1 500 000           (price)
 *   500mg               (dosage)
 *
 * The trick to keeping dates out: a phone has either an explicit prefix
 * (`+`, country code, `tel:`, parens) OR a UZ mobile operator first chunk
 * starting with `9`. Bare three-chunk dotted numbers like `12.04.2026`
 * never satisfy either constraint.
 *
 * Each alternative is documented inline.
 */
const PHONE_REGEX = new RegExp(
  [
    // tel:+digits[separators] — URI form, anchored on the literal prefix.
    "tel:\\+?\\d[\\d\\s().\\-]{6,}\\d",
    // International with leading +: +CC then 7+ digits / separators.
    "\\+\\d{1,3}[\\s.\\-]?\\d{1,4}([\\s.\\-]\\d{1,4}){1,4}",
    // Solid +digits run: +998901234567 / +15550123 etc.
    "\\+\\d{7,15}",
    // Bare 998… (no plus) — UZ-only fallback for SMS exports.
    "\\b998[\\s.\\-]?\\d{2}[\\s.\\-]?\\d{3}[\\s.\\-]?\\d{2}[\\s.\\-]?\\d{2}\\b",
    // Parenthetical: (90) 123-45-67. The opening paren guarantees this is a
    // phone shape, not a date / dosage.
    "\\(\\d{1,4}\\)[\\s.\\-]?\\d{1,4}([\\s.\\-]\\d{1,4}){1,3}",
    // UZ mobile no-prefix, dotted/dashed: 90.123.45.67 — must start with 9
    // (UZ mobile prefix range) to avoid matching dates like 12.04.2026.
    "\\b9\\d[\\s.\\-]\\d{3}[\\s.\\-]\\d{2}[\\s.\\-]\\d{2}\\b",
  ].join("|"),
  "g",
);

/** UZ passport `AA 1234567` (two letters, optional space, 7 digits). */
const PASSPORT_REGEX = /\b[A-Z]{2}\s?\d{7}\b/g;

/** JSHSHIR — 14 consecutive digits. Must be word-bounded. */
const JSHSHIR_REGEX = /\b\d{14}\b/g;

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Match = {
  start: number;
  end: number;
  original: string;
  kind: RedactionKind;
};

function collectMatches(input: string, regex: RegExp, kind: RedactionKind): Match[] {
  // Re-create RegExp to ensure /g state is fresh per call (input modules).
  const re = new RegExp(regex.source, regex.flags);
  const out: Match[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length, original: m[0], kind });
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the case-insensitive name matcher from the supplied list. Names are
 * sorted longest-first so "Алишер Каримов" wins over the standalone
 * "Каримов" when both are in the list. Empty list → null (skip the pass).
 */
function buildNameRegex(knownNames: ReadonlyArray<string>): RegExp | null {
  const cleaned = knownNames
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (cleaned.length === 0) return null;
  const unique = Array.from(new Set(cleaned));
  unique.sort((a, b) => b.length - a.length);
  const pattern = unique.map(escapeRegex).join("|");
  return new RegExp(pattern, "gi");
}

/**
 * Drop matches that overlap an earlier match. We sort the merged set by
 * start position; an entry is kept only if its `start >= cursor`. Same
 * shape used by `replace_all`-style scrubbers in editors.
 */
function dropOverlaps(matches: Match[]): Match[] {
  const sorted = matches.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    // longer match wins on a tie so passport "AA 1234567" beats whatever
    // shorter pattern starts at the same offset.
    return b.end - a.end;
  });
  const out: Match[] = [];
  let cursor = 0;
  for (const m of sorted) {
    if (m.start < cursor) continue;
    out.push(m);
    cursor = m.end;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redact phones, passport / JSHSHIR ids, and emails.
 *
 * Names are NOT redacted by this entry point — call
 * `redactWithKnownNames(input, names)` if you have a name list (see
 * `src/server/ai/llm.ts` which always passes patient/doctor names).
 */
export function redact(input: string): RedactionResult {
  return runRedaction(input, []);
}

/**
 * Redact PII AND every occurrence of any string in `knownNames`.
 *
 * Matching is case-insensitive but the replacement token uses the same
 * `<NAME_N>` tag regardless of casing — `unredact` puts the original
 * (correctly-cased) substring back. This is the entry point used by the
 * LLM proxy.
 */
export function redactWithKnownNames(
  input: string,
  knownNames: ReadonlyArray<string>,
): RedactionResult {
  return runRedaction(input, knownNames);
}

function runRedaction(
  input: string,
  knownNames: ReadonlyArray<string>,
): RedactionResult {
  if (input.length === 0) {
    return { redacted: "", replacements: [] };
  }

  const all: Match[] = [];

  // Order matters only via dropOverlaps tie-breaks; we collect all then
  // resolve overlaps once.
  all.push(...collectMatches(input, EMAIL_REGEX, "EMAIL"));
  all.push(...collectMatches(input, PHONE_REGEX, "PHONE"));
  all.push(...collectMatches(input, PASSPORT_REGEX, "PASSPORT"));
  all.push(...collectMatches(input, JSHSHIR_REGEX, "PASSPORT"));

  const nameRe = buildNameRegex(knownNames);
  if (nameRe) {
    all.push(...collectMatches(input, nameRe, "NAME"));
  }

  const matches = dropOverlaps(all);

  if (matches.length === 0) {
    return { redacted: input, replacements: [] };
  }

  // Per-kind 1-indexed counters. Same `original` string within a single call
  // gets the same token (so "позвонил Сафарову, Сафаров перезвонил" yields
  // one `<NAME_1>` token, not two).
  const counters: Record<RedactionKind, number> = {
    NAME: 0,
    PHONE: 0,
    PASSPORT: 0,
    EMAIL: 0,
  };
  const seen = new Map<string, RedactionReplacement>();
  const replacements: RedactionReplacement[] = [];

  let cursor = 0;
  let out = "";
  for (const m of matches) {
    out += input.slice(cursor, m.start);
    // Dedup on (kind, normalized original). Names are normalized
    // case-insensitively so "Сафаров" and "сафаров" share a token.
    const dedupKey =
      m.kind === "NAME"
        ? `${m.kind}::${m.original.toLowerCase()}`
        : `${m.kind}::${m.original}`;
    let entry = seen.get(dedupKey);
    if (!entry) {
      counters[m.kind] += 1;
      const token = `<${m.kind}_${counters[m.kind]}>`;
      entry = { token, original: m.original, kind: m.kind };
      seen.set(dedupKey, entry);
      replacements.push(entry);
    }
    out += entry.token;
    cursor = m.end;
  }
  out += input.slice(cursor);

  return { redacted: out, replacements };
}

/**
 * Inverse of `redact` / `redactWithKnownNames`. Substitutes every token in
 * `replacements` back with its `original` text.
 *
 * Substitution is global: a token that the LLM inserted multiple times in
 * its response is replaced everywhere. Tokens that do not appear are
 * silently ignored — the LLM may legitimately omit them.
 */
export function unredact(
  redacted: string,
  replacements: ReadonlyArray<RedactionReplacement>,
): string {
  if (replacements.length === 0) return redacted;
  let out = redacted;
  // Replace longer tokens first to avoid `<NAME_1>` matching inside
  // `<NAME_10>`. Tokens are unique per call so a simple sort works.
  const sorted = replacements
    .slice()
    .sort((a, b) => b.token.length - a.token.length);
  for (const r of sorted) {
    out = out.split(r.token).join(r.original);
  }
  return out;
}
