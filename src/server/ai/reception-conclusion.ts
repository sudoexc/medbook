/**
 * Phase 3b — Reception AI: build conclusion markdown from structured fields.
 *
 * The doctor fills chips (complaints / anamnesis / examination / prescriptions
 * / advice) plus a diagnosis. This wrapper asks the LLM to assemble those
 * fragments into a Russian (or Uzbek) consultation note formatted as the
 * doctor would write it — full sentences, proper section headings, no
 * invented facts.
 *
 * The endpoint returns the generated markdown to the client; the client
 * decides whether to overwrite `bodyMarkdown` or merge. The server does
 * NOT auto-PATCH the note — that's a destructive action and stays with
 * the doctor.
 *
 * Deterministic fallback: if the LLM fails, we render a section-headed
 * markdown block from the same chips, so the doctor still saves time
 * over typing from scratch.
 */

import { callLLM } from "./llm";

export type BuildConclusionInput = {
  patient: {
    fullName: string;
    age: number | null;
    gender: "M" | "F" | null;
  };
  complaints: string[];
  anamnesis: string[];
  examination: string[];
  prescriptions: string[];
  advice: string[];
  diagnosisCode: string | null;
  diagnosisName: string | null;
  locale: "ru" | "uz";
};

export type BuildConclusionResult = {
  markdown: string;
  fromFallback: boolean;
};

const SYSTEM_RU =
  "Ты — врачебный AI-ассистент. На основе структурированных данных приёма " +
  "собери полное заключение в виде врачебной записи на русском языке. " +
  "Используй разделы: Жалобы, Анамнез, Объективно, Диагноз, Назначения, " +
  "Рекомендации. Пиши полными предложениями. Не выдумывай факты, которых " +
  "нет во входных данных. Не упоминай ID, не используй имена пациента. " +
  "Верни ТОЛЬКО текст заключения без обёрток, markdown без таблиц.";

const SYSTEM_UZ =
  "Sen — shifokor uchun AI-yordamchi. Tuzilgan ma'lumotlardan to‘liq xulosani " +
  "o‘zbek tilida tuz. Bo‘limlar: Shikoyatlar, Anamnez, Obyektiv, Tashxis, " +
  "Tayinlovlar, Tavsiyalar. To‘liq jumlalar bilan yoz. Mavjud bo‘lmagan " +
  "faktlarni o‘ylab topma. Faqat matn qaytar.";

function buildUserContent(input: BuildConclusionInput): string {
  const lines: string[] = [];
  if (input.complaints.length > 0)
    lines.push(`Жалобы: ${input.complaints.join(", ")}.`);
  if (input.anamnesis.length > 0)
    lines.push(`Анамнез: ${input.anamnesis.join(", ")}.`);
  if (input.examination.length > 0)
    lines.push(`Осмотр: ${input.examination.join(", ")}.`);
  if (input.diagnosisCode || input.diagnosisName) {
    lines.push(
      `Диагноз: ${[input.diagnosisCode, input.diagnosisName]
        .filter(Boolean)
        .join(" — ")}.`,
    );
  }
  if (input.prescriptions.length > 0)
    lines.push(`Назначения: ${input.prescriptions.join("; ")}.`);
  if (input.advice.length > 0)
    lines.push(`Рекомендации: ${input.advice.join("; ")}.`);
  return lines.join("\n");
}

function renderFallback(input: BuildConclusionInput): string {
  const parts: string[] = [];
  if (input.complaints.length > 0) {
    parts.push(`Жалобы: ${input.complaints.join(", ")}.`);
  }
  if (input.anamnesis.length > 0) {
    parts.push("");
    parts.push(`Анамнез: ${input.anamnesis.join(", ")}.`);
  }
  if (input.examination.length > 0) {
    parts.push("");
    parts.push(`Объективно: ${input.examination.join(", ")}.`);
  }
  if (input.diagnosisCode || input.diagnosisName) {
    parts.push("");
    parts.push(
      `Диагноз: ${[input.diagnosisCode, input.diagnosisName]
        .filter(Boolean)
        .join(" ")}.`,
    );
  }
  if (input.prescriptions.length > 0) {
    parts.push("");
    parts.push("Назначения:");
    for (const p of input.prescriptions) parts.push(`- ${p}`);
  }
  if (input.advice.length > 0) {
    parts.push("");
    parts.push("Рекомендации:");
    for (const a of input.advice) parts.push(`- ${a}`);
  }
  return parts.join("\n");
}

function collectKnownNames(input: BuildConclusionInput): string[] {
  const set = new Set<string>();
  for (const part of input.patient.fullName.split(/\s+/)) {
    if (part.length > 1) set.add(part);
  }
  return Array.from(set);
}

export async function buildConclusionMarkdown(
  clinicId: string,
  userId: string | null,
  input: BuildConclusionInput,
): Promise<BuildConclusionResult> {
  const hasSignal =
    input.complaints.length > 0 ||
    input.anamnesis.length > 0 ||
    input.examination.length > 0 ||
    input.prescriptions.length > 0 ||
    input.advice.length > 0 ||
    !!input.diagnosisCode ||
    !!input.diagnosisName;
  if (!hasSignal) return { markdown: "", fromFallback: true };

  const system = input.locale === "uz" ? SYSTEM_UZ : SYSTEM_RU;
  try {
    const response = await callLLM({
      clinicId,
      userId: userId ?? undefined,
      useCase: "reception.conclusion",
      system,
      messages: [{ role: "user", content: buildUserContent(input) }],
      knownNames: collectKnownNames(input),
      maxTokens: 900,
      temperature: 0.25,
    });
    const trimmed = response.text.trim();
    if (trimmed.length > 0) {
      return { markdown: trimmed, fromFallback: false };
    }
  } catch {
    // fall through to deterministic builder
  }
  return { markdown: renderFallback(input), fromFallback: true };
}
