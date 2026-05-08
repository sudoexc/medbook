/**
 * Phase 15 Wave 4 — Marketing copy generator.
 *
 * Use case: admin opens the notification template editor, asks the AI for
 * three SMS / TG / Email variants for a target audience (reactivation,
 * birthday, reminder, no-show, generic), picks one, then saves it as the
 * template body via the existing form. The pipeline here only produces the
 * variants — actual save remains a manual step (Wave 5+ may add direct save
 * with audit).
 *
 * Why a thin wrapper?
 *   - All proxy concerns (PII redaction, rate limit, cost, cache, audit) are
 *     handled by `callLLM`. This module only owns the prompt and the
 *     parser. Keeping the parser deliberately defensive means a misbehaved
 *     LLM never crashes the editor; we just fall back to a degraded shape.
 *
 * Parser strategy:
 *   1. Look for explicit "1.", "2.", "3." line prefixes (the format the
 *      system prompt requests).
 *   2. If that yields nothing, split on blank lines and treat each chunk as
 *      one variant.
 *   3. If still empty, return the raw text as a single variant. Never
 *      throw — admin sees something even if formatting is junk.
 *
 * No truncation: variants over `maxChars` are returned verbatim with
 * `withinLimit: false`. The UI shows a red chip; the admin decides whether
 * to use them or regenerate.
 */

import { callLLM, type LLMResponse } from "./llm";

export type MarketingCopyChannel = "SMS" | "TG" | "EMAIL" | "PUSH" | "INAPP";
export type MarketingCopyAudience =
  | "reactivation"
  | "birthday"
  | "reminder"
  | "no-show"
  | "general";
export type MarketingCopyTone = "friendly" | "professional" | "urgent";
export type MarketingCopyLocale = "ru" | "uz";

export type MarketingCopyInput = {
  clinicId: string;
  userId: string;
  channel: MarketingCopyChannel;
  audience: MarketingCopyAudience;
  locale: MarketingCopyLocale;
  /** Default by channel: SMS=200, TG=500, EMAIL=2000, PUSH=200, INAPP=300. */
  maxChars?: number;
  /** Default `friendly`. */
  tone?: MarketingCopyTone;
  /** Free-form promo copy passed through verbatim — e.g. "20% off until Dec 31". */
  promo?: string;
  /** Free-form admin notes — "mention winter season", "patient cohort: dormant 90+". */
  customNotes?: string;
  /** Default 3. Capped to 1..5 to keep the prompt sensible. */
  variants?: number;
};

export type MarketingCopyVariant = {
  text: string;
  charCount: number;
  withinLimit: boolean;
};

export type MarketingCopyResult = {
  variants: MarketingCopyVariant[];
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
};

/** Channel → default character limit when caller doesn't pass `maxChars`. */
export const DEFAULT_MAX_CHARS_BY_CHANNEL: Record<
  MarketingCopyChannel,
  number
> = {
  SMS: 200,
  TG: 500,
  EMAIL: 2000,
  PUSH: 200,
  INAPP: 300,
};

const DEFAULT_TONE: MarketingCopyTone = "friendly";
const DEFAULT_VARIANTS = 3;

function clampVariants(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_VARIANTS;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.floor(n);
}

function resolveMaxChars(input: MarketingCopyInput): number {
  if (input.maxChars && Number.isFinite(input.maxChars) && input.maxChars > 0) {
    return Math.floor(input.maxChars);
  }
  return DEFAULT_MAX_CHARS_BY_CHANNEL[input.channel];
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  locale: MarketingCopyLocale,
  channel: MarketingCopyChannel,
  audience: MarketingCopyAudience,
  tone: MarketingCopyTone,
  maxChars: number,
  variants: number,
): string {
  return [
    "Ты — маркетолог-копирайтер клиники.",
    `Пиши на ${locale}.`,
    `Канал: ${channel}.`,
    `Целевая аудитория: ${audience}.`,
    `Тон: ${tone}.`,
    `Лимит: ${maxChars} символов.`,
    `Сгенерируй РОВНО ${variants} ${variants === 1 ? "вариант" : "варианта"}, ` +
      "каждый на новой строке с префиксом '1.', '2.', '3.' и т.д.",
    "Если задан promo — обязательно упомяни его.",
    "Не выдумывай скидки или сроки, не указанные в задании.",
    "Не повторяй префикс канала и не пиши заголовков — только тело сообщения.",
  ].join(" ");
}

function buildUserContent(
  input: MarketingCopyInput,
  resolvedTone: MarketingCopyTone,
  resolvedMaxChars: number,
  resolvedVariants: number,
): string {
  const lines: string[] = [];
  lines.push(`Канал: ${input.channel}`);
  lines.push(`Аудитория: ${input.audience}`);
  lines.push(`Локаль: ${input.locale}`);
  lines.push(`Тон: ${resolvedTone}`);
  lines.push(`Лимит символов: ${resolvedMaxChars}`);
  lines.push(`Количество вариантов: ${resolvedVariants}`);
  if (input.promo && input.promo.trim().length > 0) {
    lines.push(`Промо: ${input.promo.trim()}`);
  }
  if (input.customNotes && input.customNotes.trim().length > 0) {
    lines.push(`Примечания: ${input.customNotes.trim()}`);
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the raw LLM text into an ordered list of variant strings.
 *
 * Strategy (in order):
 *   1. Numbered list — each variant starts with `<digits>.` or `<digits>)`
 *      at the beginning of a line. Multi-line variants are folded back
 *      together until the next "<n>." marker.
 *   2. Blank-line split — useful when the LLM prefixed bullets with `-`
 *      or used markdown-ish separators.
 *   3. Single-variant fallback — return whatever we got.
 *
 * Trailing/leading whitespace is trimmed from each variant; empty entries
 * are dropped.
 */
export function parseMarketingCopyVariants(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const numberedRe = /^\s*(\d+)\s*[\.\)]\s*/;
  const lines = trimmed.split(/\r?\n/);
  const out: string[] = [];
  let buf: string[] = [];
  let inNumbered = false;

  for (const line of lines) {
    if (numberedRe.test(line)) {
      // flush previous chunk
      if (buf.length > 0) {
        const v = buf.join("\n").trim();
        if (v.length > 0) out.push(v);
      }
      buf = [line.replace(numberedRe, "")];
      inNumbered = true;
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) {
    const v = buf.join("\n").trim();
    if (v.length > 0) out.push(v);
  }
  if (inNumbered && out.length > 0) return out;

  // 2) Blank-line split.
  const chunks = trimmed
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (chunks.length >= 2) return chunks;

  // 3) Last resort — single variant.
  return [trimmed];
}

function buildVariants(
  rawVariants: string[],
  maxChars: number,
): MarketingCopyVariant[] {
  return rawVariants.map((text) => {
    const charCount = [...text].length; // grapheme-ish but good enough for SMS counting.
    return {
      text,
      charCount,
      withinLimit: charCount <= maxChars,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function generateMarketingCopy(
  input: MarketingCopyInput,
): Promise<MarketingCopyResult> {
  const tone = input.tone ?? DEFAULT_TONE;
  const maxChars = resolveMaxChars(input);
  const variants = clampVariants(input.variants);

  const system = buildSystemPrompt(
    input.locale,
    input.channel,
    input.audience,
    tone,
    maxChars,
    variants,
  );
  const userContent = buildUserContent(input, tone, maxChars, variants);

  const response: LLMResponse = await callLLM({
    clinicId: input.clinicId,
    userId: input.userId,
    useCase: "marketing.copy",
    system,
    messages: [{ role: "user", content: userContent }],
    knownNames: [],
    // Generous output — three 500-char variants with line breaks comfortably
    // fit under 1024 tokens.
    maxTokens: 1024,
    temperature: 0.7,
  });

  const rawVariants = parseMarketingCopyVariants(response.text);
  const built = buildVariants(rawVariants, maxChars);

  return {
    variants: built,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    costUzs: response.costUzs,
  };
}
