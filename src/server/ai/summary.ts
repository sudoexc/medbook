/**
 * Phase 15 Wave 2 — Patient summary generator.
 *
 * `generatePatientSummary(...)` is the use-case-specific wrapper around
 * `callLLM({ useCase: "patient.summary" })`. It takes an already-loaded
 * patient context (the function deliberately performs zero DB reads — that
 * stays the caller's responsibility, see
 * `src/server/ai/patient-summary-cache.ts`) and produces a 2–4 sentence
 * Russian or Uzbek free-text summary aimed at the doctor opening the card.
 *
 * Why no DB reads here?
 *   - The cache wrapper already has the patient row in hand and can pick
 *     the recent visits + open cases shape it wants (limit 3, order, etc.).
 *   - Pure-function summary builders are trivially testable: pass an input,
 *     assert on the LLM stub.
 *
 * Redaction:
 *   - We pass `knownNames: [firstName, lastName, ...visit doctor names]`
 *     down to `callLLM`, which scrubs them to `<NAME_N>` tokens before the
 *     provider sees the prompt. The unredacted text comes back from
 *     `callLLM` already substituted, so the caller can render it as-is.
 *
 * Fallback:
 *   - When the LLM returns an empty / whitespace-only string, we fall back
 *     to a deterministic "{first} {last}, {age}, постоянный пациент с
 *     {year}" template so the patient card never shows a blank. The
 *     fallback is in the active locale.
 */

import { callLLM, type LLMResponse } from "./llm";

export type PatientSummaryInput = {
  patientId: string;
  /**
   * Pre-fetched patient demographics. Names are kept split here because the
   * UZ/RU "First Last" vs. "Фамилия Имя Отчество" ordering varies by source;
   * the caller decides how it wants to split `Patient.fullName` (e.g.
   * first space token = first name, rest = last name).
   */
  patient: {
    firstName: string;
    lastName: string;
    birthYear: number | null;
    createdAt: Date;
    gender: "M" | "F" | null;
  };
  /** Latest first. The cache wrapper trims to 3 before it gets here. */
  recentVisits: Array<{
    date: Date;
    doctorSpecialty: string;
    diagnosis: string | null;
    notes: string | null;
    prescriptions: string | null;
  }>;
  openCases: Array<{
    openedAt: Date;
    title: string;
    lastNote: string | null;
  }>;
  locale: "ru" | "uz";
};

export type PatientSummaryResult = {
  text: string;
  generatedAt: Date;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
};

const SYSTEM_PROMPT_RU =
  "Ты — AI-ассистент клиники. Сгенерируй сжатое резюме пациента (2-4 предложения) " +
  "для лечащего врача на языке ru. Включи: возраст, диагноз и последний визит, " +
  "текущие назначения, важные наблюдения. Не выдумывай данные. Не упоминай ID.";

const SYSTEM_PROMPT_UZ =
  "Ty — AI-ассистент клиники. Сгенерируй сжатое резюме пациента (2-4 предложения) " +
  "для лечащего врача на языке uz. Включи: возраст, диагноз и последний визит, " +
  "текущие назначения, важные наблюдения. Не выдумывай данные. Не упоминай ID.";

function buildSystemPrompt(locale: "ru" | "uz"): string {
  return locale === "uz" ? SYSTEM_PROMPT_UZ : SYSTEM_PROMPT_RU;
}

function ageFromBirthYear(birthYear: number | null, now: Date): number | null {
  if (birthYear == null) return null;
  const age = now.getFullYear() - birthYear;
  if (!Number.isFinite(age) || age < 0 || age > 130) return null;
  return age;
}

function formatYmd(d: Date): string {
  // Deterministic ISO-ish date so the prompt hash is stable across calls.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Serialize the input deterministically. Used as the user message to the
 * LLM. We keep the shape simple (one line per visit / case) so the model
 * can read it without YAML/JSON parsing surprises.
 */
function buildUserContent(input: PatientSummaryInput): string {
  const { patient, recentVisits, openCases } = input;
  const age = ageFromBirthYear(patient.birthYear, new Date());

  const lines: string[] = [];
  lines.push(
    `Пациент: ${patient.firstName} ${patient.lastName}` +
      (patient.gender ? `, ${patient.gender}` : "") +
      (age != null ? `, возраст ${age}` : "") +
      `, в клинике с ${patient.createdAt.getFullYear()}.`,
  );

  if (recentVisits.length === 0) {
    lines.push("Визитов нет.");
  } else {
    lines.push("Последние визиты:");
    for (const v of recentVisits) {
      const parts = [formatYmd(v.date), v.doctorSpecialty];
      if (v.diagnosis) parts.push(`диагноз: ${v.diagnosis}`);
      if (v.prescriptions) parts.push(`назначения: ${v.prescriptions}`);
      if (v.notes) parts.push(`заметки: ${v.notes}`);
      lines.push(`- ${parts.join("; ")}`);
    }
  }

  if (openCases.length > 0) {
    lines.push("Открытые случаи:");
    for (const c of openCases) {
      const parts = [formatYmd(c.openedAt), c.title];
      if (c.lastNote) parts.push(`последняя заметка: ${c.lastNote}`);
      lines.push(`- ${parts.join("; ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Deterministic fallback used when the LLM returns nothing useful. Locale
 * controls the language; year comes from the patient's `createdAt`.
 */
export function buildFallbackSummary(input: PatientSummaryInput): string {
  const { patient, locale } = input;
  const age = ageFromBirthYear(patient.birthYear, new Date());
  const year = patient.createdAt.getFullYear();
  const fullName = `${patient.firstName} ${patient.lastName}`.trim();
  if (locale === "uz") {
    const ageStr = age != null ? `, ${age} yosh` : "";
    return `${fullName}${ageStr}, ${year}-yildan beri klinika mijozi.`;
  }
  const ageStr = age != null ? `, ${age}` : "";
  return `${fullName}${ageStr}, постоянный пациент с ${year}.`;
}

function collectKnownNames(input: PatientSummaryInput): string[] {
  const set = new Set<string>();
  if (input.patient.firstName) set.add(input.patient.firstName);
  if (input.patient.lastName) set.add(input.patient.lastName);
  for (const v of input.recentVisits) {
    if (v.doctorSpecialty) set.add(v.doctorSpecialty);
  }
  return Array.from(set).filter((n) => n.length > 0);
}

export async function generatePatientSummary(
  clinicId: string,
  userId: string | null,
  input: PatientSummaryInput,
): Promise<PatientSummaryResult> {
  const system = buildSystemPrompt(input.locale);
  const userContent = buildUserContent(input);
  const knownNames = collectKnownNames(input);

  let response: LLMResponse;
  try {
    response = await callLLM({
      clinicId,
      userId: userId ?? undefined,
      useCase: "patient.summary",
      system,
      messages: [{ role: "user", content: userContent }],
      knownNames,
      maxTokens: 400,
      temperature: 0.2,
    });
  } catch (err) {
    // Even rate-limit / provider failures should not break the patient
    // card — fall back to the deterministic line.
    return {
      text: buildFallbackSummary(input),
      generatedAt: new Date(),
      inputTokens: 0,
      outputTokens: 0,
      costUzs: 0,
    };
  }

  const trimmed = response.text.trim();
  const text = trimmed.length > 0 ? trimmed : buildFallbackSummary(input);

  return {
    text,
    generatedAt: new Date(),
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    costUzs: response.costUzs,
  };
}
