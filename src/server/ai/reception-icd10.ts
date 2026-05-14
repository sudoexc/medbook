/**
 * Phase 3b — Reception AI: ICD-10 ranked suggestions.
 *
 * Given complaints + examination + age + gender, ask the LLM to rank
 * 3–5 likely ICD-10 codes from our curated universe (`ICD10_ENTRIES`),
 * each with a confidence band (`likely` | `possible`).
 *
 * Hard rule: never let the model invent codes — we project its output
 * onto the curated set. If the model returns "G44.2" but that code isn't
 * in our list, we drop it. This keeps the suggestion ↔ search workflow
 * coherent (the doctor can't get a hint that's unsearchable).
 */

import { callLLM } from "./llm";
import { ICD10_ENTRIES, type Icd10Entry } from "./../icd10/data";

export type Icd10SuggestInput = {
  patient: {
    age: number | null;
    gender: "M" | "F" | null;
  };
  complaints: string[];
  examination: string[];
  anamnesis: string[];
  locale: "ru" | "uz";
};

export type Icd10Suggestion = {
  code: string;
  nameRu: string;
  tone: "likely" | "possible";
};

export type Icd10SuggestResult = {
  suggestions: Icd10Suggestion[];
  fromFallback: boolean;
};

const SYSTEM_RU =
  "Ты — врачебный AI-ассистент. Оцени жалобы, анамнез и данные осмотра, " +
  "и предложи 3–5 кодов МКБ-10 ИЗ ПРЕДЛОЖЕННОГО СПИСКА. Для каждого укажи " +
  "уверенность: \"likely\" (наиболее вероятно) или \"possible\" (возможно). " +
  "Не придумывай коды, которых нет в списке. Верни ТОЛЬКО JSON-массив объектов: " +
  '[{"code":"F41.1","confidence":"likely"},{"code":"G44.2","confidence":"possible"}]';

function buildUserContent(input: Icd10SuggestInput): string {
  const lines: string[] = [];
  const age = input.patient.age != null ? `возраст ${input.patient.age}` : "возраст неизвестен";
  const gender = input.patient.gender ? `пол ${input.patient.gender}` : "пол неизвестен";
  lines.push(`Пациент: ${age}, ${gender}.`);
  if (input.complaints.length > 0)
    lines.push(`Жалобы: ${input.complaints.join(", ")}.`);
  if (input.anamnesis.length > 0)
    lines.push(`Анамнез: ${input.anamnesis.join(", ")}.`);
  if (input.examination.length > 0)
    lines.push(`Осмотр: ${input.examination.join(", ")}.`);

  lines.push("");
  lines.push("Доступные коды МКБ-10 (выбирай только из этого списка):");
  // Cap to a manageable subset so the prompt stays under ~6k tokens.
  for (const e of ICD10_ENTRIES) {
    lines.push(`${e.code} — ${e.nameRu}`);
  }
  return lines.join("\n");
}

type RawSuggestion = { code: string; confidence: string };

function parseSuggestions(text: string): RawSuggestion[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const arr = JSON.parse(stripped) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: RawSuggestion[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const code = (item as { code?: unknown }).code;
      const conf = (item as { confidence?: unknown }).confidence;
      if (typeof code !== "string") continue;
      if (typeof conf !== "string") continue;
      out.push({ code: code.trim(), confidence: conf.trim().toLowerCase() });
    }
    return out;
  } catch {
    return null;
  }
}

function buildCodeIndex(): Map<string, Icd10Entry> {
  const m = new Map<string, Icd10Entry>();
  for (const e of ICD10_ENTRIES) m.set(e.code.toUpperCase(), e);
  return m;
}

const CODE_INDEX = buildCodeIndex();

export async function suggestIcd10Codes(
  clinicId: string,
  userId: string | null,
  input: Icd10SuggestInput,
): Promise<Icd10SuggestResult> {
  // No useful signal — return empty rather than fabricate.
  const hasSignal =
    input.complaints.length > 0 ||
    input.examination.length > 0 ||
    input.anamnesis.length > 0;
  if (!hasSignal) return { suggestions: [], fromFallback: false };

  try {
    const response = await callLLM({
      clinicId,
      userId: userId ?? undefined,
      useCase: "reception.icd10",
      system: SYSTEM_RU,
      messages: [{ role: "user", content: buildUserContent(input) }],
      knownNames: [],
      maxTokens: 400,
      temperature: 0.1,
    });
    const raw = parseSuggestions(response.text);
    if (!raw || raw.length === 0) return { suggestions: [], fromFallback: true };

    const out: Icd10Suggestion[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      const key = r.code.toUpperCase();
      if (seen.has(key)) continue;
      const entry = CODE_INDEX.get(key);
      if (!entry) continue;
      seen.add(key);
      out.push({
        code: entry.code,
        nameRu: entry.nameRu,
        tone: r.confidence === "likely" ? "likely" : "possible",
      });
      if (out.length >= 5) break;
    }
    return { suggestions: out, fromFallback: false };
  } catch {
    return { suggestions: [], fromFallback: true };
  }
}
