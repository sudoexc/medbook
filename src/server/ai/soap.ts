/**
 * Phase 15 Wave 5 — Voice → SOAP structurer.
 *
 * Takes a Whisper transcript and asks the LLM to format it into the four
 * canonical SOAP sections (Subjective / Objective / Assessment / Plan).
 *
 * Why a thin wrapper around `callLLM`?
 *   - Same reasoning as `summary.ts` and `marketing-copy.ts`: PII redaction,
 *     rate limit, cache, audit, and cost are the proxy's job. This module
 *     only owns the prompt and the parser.
 *
 * Parser strategy:
 *   - Split the LLM response on `### Subjective`, `### Objective`,
 *     `### Assessment`, `### Plan` headers (case-insensitive). Anything
 *     before the first header is dropped.
 *   - If parsing fails (no headers match), return `raw` and put the whole
 *     text in `subjective` so the doctor at least sees the AI output and
 *     can re-format it manually.
 *   - Empty transcript → empty SOAP with `raw === ""`. We still call the
 *     LLM (the prompt asks it to acknowledge "no input") so the audit row
 *     captures the no-op cost.
 *
 * Stored value:
 *   - The worker concatenates the four sections back into a markdown
 *     string (`### Subjective\n...\n### Objective\n...`) and writes it to
 *     `MedicalCase.soapDraft`. The doctor sees the structured form
 *     directly in CRM.
 */

import { callLLM, type LLMResponse } from "./llm";

export type SoapStructureInput = {
  clinicId: string;
  userId: string;
  caseId: string;
  transcriptText: string;
  /** Patient identity passed to the redactor as `knownNames`. */
  patientContext: { fullName: string; birthYear: number | null };
  locale: "ru" | "uz";
};

export type SoapStructureResult = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  /** The raw LLM response text, kept for the graceful-fallback path. */
  raw: string;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
};

const SYSTEM_PROMPT_RU = [
  "Ты — медицинский ассистент клиники.",
  "Тебе дают расшифровку голосовой заметки врача после визита.",
  "Структурируй её по схеме SOAP с заголовками `### Subjective`, `### Objective`, `### Assessment`, `### Plan`.",
  "ВАЖНО:",
  "- Не выдумывай данные. Если врач не назвал что-то — оставь раздел пустым.",
  "- Не упоминай ID пациента или внутренние коды.",
  "- Subjective: жалобы и анамнез со слов пациента.",
  "- Objective: осмотр, измерения, наблюдения врача.",
  "- Assessment: предварительный диагноз.",
  "- Plan: назначения, обследования, рекомендации.",
  "Ответ — строго четыре раздела с указанными заголовками, без вступления и заключения.",
].join(" ");

const SYSTEM_PROMPT_UZ = [
  "Ty — медицинский ассистент клиники.",
  "Тебе дают расшифровку голосовой заметки врача после визита.",
  "Структурируй её по схеме SOAP с заголовками `### Subjective`, `### Objective`, `### Assessment`, `### Plan`.",
  "ВАЖНО (uz):",
  "- Не выдумывай данные. Если врач не назвал что-то — оставь раздел пустым.",
  "- Не упоминай ID пациента или внутренние коды.",
  "- Sections: Subjective (shikoyatlar/anamnez), Objective (ko'rik), Assessment (tashxis), Plan (tavsiyalar).",
  "Ответ — строго четыре раздела с указанными заголовками.",
].join(" ");

function buildSystemPrompt(locale: "ru" | "uz"): string {
  return locale === "uz" ? SYSTEM_PROMPT_UZ : SYSTEM_PROMPT_RU;
}

function buildUserContent(transcriptText: string): string {
  const trimmed = transcriptText.trim();
  if (trimmed.length === 0) {
    return "[пустая расшифровка] Голосовое сообщение не содержит распознаваемой речи.";
  }
  return `Расшифровка:\n${trimmed}`;
}

/**
 * Tokenise the LLM output into its four SOAP sections by header name.
 *
 * The regexp accepts both `### Subjective` and `### subjective`, with or
 * without trailing punctuation, so Anthropic / Claude variations don't
 * break us. Section bodies span every line until the next matching header
 * (or end of text). Anything before the first header is dropped.
 */
export function parseSoapSections(text: string): {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  ok: boolean;
} {
  const empty = { subjective: "", objective: "", assessment: "", plan: "" };
  if (!text || text.trim().length === 0) {
    return { ...empty, ok: false };
  }

  // Match at start of a line: optional whitespace + "###" + spaces +
  // section name (case-insensitive). Localised section names share the
  // English keys per the system prompt.
  const headerRe =
    /^\s{0,3}#{1,6}\s*(Subjective|Objective|Assessment|Plan)\s*[:.]?\s*$/gim;

  type Hit = { name: keyof typeof empty; index: number; end: number };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text))) {
    const raw = m[1].toLowerCase();
    const key =
      raw === "subjective"
        ? "subjective"
        : raw === "objective"
          ? "objective"
          : raw === "assessment"
            ? "assessment"
            : "plan";
    hits.push({ name: key, index: m.index, end: m.index + m[0].length });
  }
  if (hits.length === 0) return { ...empty, ok: false };

  const out = { ...empty };
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1];
    const body = text
      .slice(h.end, next ? next.index : text.length)
      .replace(/^\s*\n/, "")
      .replace(/\n\s*$/, "")
      .trim();
    out[h.name] = body;
  }
  // Consider the parse "ok" if we actually populated at least one section.
  const ok = (
    out.subjective.length +
    out.objective.length +
    out.assessment.length +
    out.plan.length
  ) > 0;
  return { ...out, ok };
}

/**
 * Re-stitch the parsed sections into the markdown form stored on
 * `MedicalCase.soapDraft`. Empty sections render as a header with no body
 * so the doctor sees where to fill in.
 */
export function stitchSoapMarkdown(parts: {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}): string {
  return [
    "### Subjective",
    parts.subjective || "",
    "",
    "### Objective",
    parts.objective || "",
    "",
    "### Assessment",
    parts.assessment || "",
    "",
    "### Plan",
    parts.plan || "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function structureSoap(
  input: SoapStructureInput,
): Promise<SoapStructureResult> {
  const system = buildSystemPrompt(input.locale);
  const userContent = buildUserContent(input.transcriptText);

  // knownNames forwarded so the redactor scrubs the patient's name out of
  // both the transcript (user message) and the response — same convention
  // as `summary.ts`.
  const knownNames = collectKnownNames(input.patientContext.fullName);

  let response: LLMResponse;
  try {
    response = await callLLM({
      clinicId: input.clinicId,
      userId: input.userId,
      useCase: "voice.soap",
      system,
      messages: [{ role: "user", content: userContent }],
      knownNames,
      maxTokens: 800,
      temperature: 0.2,
    });
  } catch {
    // Rate limit / provider error → return empty SOAP gracefully. The
    // worker writes nothing back in that case (callers check `.raw === ""`).
    return {
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
      raw: "",
      inputTokens: 0,
      outputTokens: 0,
      costUzs: 0,
    };
  }

  const raw = response.text ?? "";
  const parsed = parseSoapSections(raw);

  if (!parsed.ok) {
    // Malformed / parser miss → put the whole response in `subjective` so
    // the doctor sees something. The dashboard can later filter on
    // `raw !== "" && subjective === raw` to find these.
    return {
      subjective: raw.trim(),
      objective: "",
      assessment: "",
      plan: "",
      raw,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUzs: response.costUzs,
    };
  }

  return {
    subjective: parsed.subjective,
    objective: parsed.objective,
    assessment: parsed.assessment,
    plan: parsed.plan,
    raw,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    costUzs: response.costUzs,
  };
}

/**
 * Split fullName into discrete tokens for `knownNames`. The redactor matches
 * each as a whole-word substring, so passing both the joined fullName and
 * each part covers most ordering variants ("Иванов И.И." vs. "И. И. Иванов").
 */
function collectKnownNames(fullName: string): string[] {
  const trimmed = (fullName ?? "").trim();
  if (trimmed.length === 0) return [];
  const out = new Set<string>([trimmed]);
  for (const part of trimmed.split(/\s+/)) {
    const p = part.replace(/[^\p{L}\-]/gu, "").trim();
    if (p.length >= 2) out.add(p);
  }
  return Array.from(out);
}
