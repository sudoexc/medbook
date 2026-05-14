/**
 * Phase 3b — Reception AI: clarifying questions.
 *
 * Given the doctor's in-progress VisitNote draft + recent patient history,
 * produce 3–5 follow-up questions the doctor should ask to disambiguate
 * the diagnosis. The output is a strict JSON array of strings; we parse,
 * trim, dedupe, and cap at 5.
 *
 * Falls back to a small static set when the model can't be parsed or
 * rate-limit / provider failure fires — the right rail must never be
 * empty when the doctor activates a session.
 */

import { callLLM } from "./llm";

export type ClarifyingInput = {
  patient: {
    fullName: string;
    age: number | null;
    gender: "M" | "F" | null;
  };
  draft: {
    complaints: string[];
    anamnesis: string[];
    examination: string[];
    diagnosisCode: string | null;
    diagnosisName: string | null;
  };
  recentVisits: Array<{
    date: Date;
    diagnosis: string | null;
    notes: string | null;
  }>;
  locale: "ru" | "uz";
};

export type ClarifyingResult = {
  questions: string[];
  fromFallback: boolean;
};

const SYSTEM_RU =
  "Ты — врачебный AI-ассистент. На основе текущего черновика приёма и истории пациента " +
  "сформируй 3–5 уточняющих вопросов, которые помогут врачу дифференцировать диагноз " +
  "и собрать недостающие данные. Вопросы должны быть конкретными, короткими, " +
  "клинически значимыми. Не повторяй то, что уже указано в жалобах. " +
  "Верни ТОЛЬКО JSON-массив строк без пояснений. Пример: " +
  '["Какой характер боли?","Есть ли тошнота?","Бывают ли панические атаки?"]';

const SYSTEM_UZ =
  "Sen — shifokor uchun AI-yordamchi. Joriy qabul qoralamasi va bemorning tarixiga " +
  "asoslanib, shifokorga tashxisni aniqlashtirish uchun 3–5 ta savol tayyorla. " +
  "Savollar qisqa va klinik jihatdan ahamiyatli bo‘lsin. Faqat JSON-massiv " +
  'qaytar. Misol: ["Og‘riq qanday?","Ko‘ngil aynaydimi?"]';

const FALLBACK_RU = [
  "Уточните характер и локализацию основных жалоб.",
  "Когда впервые появились симптомы?",
  "Есть ли сопутствующие хронические заболевания?",
  "Принимает ли пациент лекарства в данный момент?",
];

const FALLBACK_UZ = [
  "Asosiy shikoyatlar xususiyatini aniqlashtiring.",
  "Belgilar qachon paydo bo‘ldi?",
  "Boshqa surunkali kasalliklar bormi?",
  "Hozirda qanday dorilar qabul qilinmoqda?",
];

function buildUserContent(input: ClarifyingInput): string {
  const lines: string[] = [];
  const p = input.patient;
  const age = p.age != null ? `, возраст ${p.age}` : "";
  const gender = p.gender ? `, ${p.gender}` : "";
  lines.push(`Пациент: ${p.fullName}${gender}${age}.`);

  const d = input.draft;
  if (d.complaints.length > 0) lines.push(`Жалобы: ${d.complaints.join(", ")}.`);
  if (d.anamnesis.length > 0) lines.push(`Анамнез: ${d.anamnesis.join(", ")}.`);
  if (d.examination.length > 0)
    lines.push(`Осмотр: ${d.examination.join(", ")}.`);
  if (d.diagnosisCode || d.diagnosisName) {
    lines.push(
      `Предполагаемый диагноз: ${[d.diagnosisCode, d.diagnosisName]
        .filter(Boolean)
        .join(" · ")}.`,
    );
  }

  if (input.recentVisits.length > 0) {
    lines.push("Последние визиты:");
    for (const v of input.recentVisits) {
      const ymd = v.date.toISOString().slice(0, 10);
      const parts = [ymd];
      if (v.diagnosis) parts.push(`диагноз: ${v.diagnosis}`);
      if (v.notes) parts.push(`заметки: ${v.notes.slice(0, 200)}`);
      lines.push(`- ${parts.join("; ")}`);
    }
  }

  return lines.join("\n");
}

function collectKnownNames(input: ClarifyingInput): string[] {
  const set = new Set<string>();
  for (const part of input.patient.fullName.split(/\s+/)) {
    if (part.length > 1) set.add(part);
  }
  return Array.from(set);
}

function parseQuestions(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Most providers wrap JSON in ```json ... ```; strip fence if present.
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const arr = JSON.parse(stripped) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: string[] = [];
    for (const item of arr) {
      if (typeof item !== "string") continue;
      const t = item.trim();
      if (t.length > 0 && t.length <= 240) out.push(t);
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function generateClarifyingQuestions(
  clinicId: string,
  userId: string | null,
  input: ClarifyingInput,
): Promise<ClarifyingResult> {
  const system = input.locale === "uz" ? SYSTEM_UZ : SYSTEM_RU;
  const fallback = input.locale === "uz" ? FALLBACK_UZ : FALLBACK_RU;

  try {
    const response = await callLLM({
      clinicId,
      userId: userId ?? undefined,
      useCase: "reception.clarifying",
      system,
      messages: [{ role: "user", content: buildUserContent(input) }],
      knownNames: collectKnownNames(input),
      maxTokens: 400,
      temperature: 0.3,
    });
    const parsed = parseQuestions(response.text);
    if (parsed && parsed.length > 0) {
      const unique = Array.from(new Set(parsed)).slice(0, 5);
      return { questions: unique, fromFallback: false };
    }
  } catch {
    // fall through to fallback
  }
  return { questions: fallback, fromFallback: true };
}
