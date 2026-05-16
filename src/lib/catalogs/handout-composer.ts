/**
 * Patient handout composer — deterministic, no LLM.
 *
 * Takes the structured fields of a VisitNote and produces a friendly,
 * patient-facing Markdown document ready to print. The composer never
 * inserts ICD-10 codes or technical jargon — only what the patient
 * actually needs to act on at home.
 *
 * Composition contract:
 *   - Output is Markdown so it renders both in our print template and as
 *     a textarea preview, and the doctor can edit it freely.
 *   - Sections without data are dropped entirely (no "Жалобы: —").
 *   - Order is fixed: greeting → diagnosis → prescriptions → advice →
 *     closing. Doctor edits the line order manually if they want
 *     something else.
 */

export type HandoutInput = {
  patientName?: string | null;
  doctorName?: string | null;
  doctorSpecialty?: string | null;
  clinicName?: string | null;
  visitDate?: Date | null;
  diagnosisName?: string | null;
  /** Free-text complaint chips from the visit note. */
  complaints?: string[];
  /** Prescription lines (already composed by the dosage builder). */
  prescriptions?: string[];
  /** Lifestyle / care advice. */
  advice?: string[];
  /** Follow-up note shown near the end. Free text. */
  followUp?: string | null;
};

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function formatDateRu(d: Date): string {
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Compose a Russian patient handout in Markdown from the structured visit
 * note. Returns an empty string when there's nothing meaningful to print
 * (no complaints + no prescriptions + no advice + no diagnosis).
 */
export function composePatientHandoutRu(input: HandoutInput): string {
  const complaints = (input.complaints ?? []).filter(Boolean);
  const prescriptions = (input.prescriptions ?? []).filter(Boolean);
  const advice = (input.advice ?? []).filter(Boolean);
  const hasContent =
    complaints.length > 0 ||
    prescriptions.length > 0 ||
    advice.length > 0 ||
    !!input.diagnosisName?.trim();

  if (!hasContent) return "";

  const parts: string[] = [];

  // ── Header ─────────────────────────────────────────────
  const firstName = input.patientName?.trim().split(/\s+/)[0] ?? "";
  parts.push(`# Памятка для пациента`);
  parts.push("");
  const greeting = firstName
    ? `Здравствуйте, ${firstName}!`
    : "Здравствуйте!";
  parts.push(greeting);
  parts.push("");

  // ── Intro line ─────────────────────────────────────────
  const dateStr = input.visitDate ? formatDateRu(input.visitDate) : null;
  const introBits: string[] = [];
  if (dateStr) introBits.push(`По итогам приёма от ${dateStr}`);
  else introBits.push("По итогам сегодняшнего приёма");
  if (input.doctorName?.trim()) {
    introBits.push(`у врача ${input.doctorName.trim()}`);
  }
  parts.push(introBits.join(" ") + " подготовлены следующие рекомендации:");
  parts.push("");

  // ── Diagnosis (no МКБ code) ────────────────────────────
  if (input.diagnosisName?.trim()) {
    parts.push(`**Диагноз:** ${input.diagnosisName.trim()}`);
    parts.push("");
  }

  // ── Complaints — shown as a brief "as you described" line ─
  if (complaints.length > 0) {
    const list = complaints.map((c) => `- ${c}`).join("\n");
    parts.push("**Жалобы, с которыми вы обратились:**");
    parts.push(list);
    parts.push("");
  }

  // ── Prescriptions ──────────────────────────────────────
  if (prescriptions.length > 0) {
    parts.push("**Назначения — что и как принимать:**");
    parts.push(prescriptions.map((p) => `- ${p}`).join("\n"));
    parts.push("");
    parts.push(
      "_Принимайте препараты строго по схеме. Если появятся побочные эффекты — свяжитесь с клиникой или вашим врачом._",
    );
    parts.push("");
  }

  // ── Advice / lifestyle ─────────────────────────────────
  if (advice.length > 0) {
    parts.push("**Рекомендации по образу жизни и уходу:**");
    parts.push(advice.map((a) => `- ${a}`).join("\n"));
    parts.push("");
  }

  // ── Follow-up ──────────────────────────────────────────
  if (input.followUp?.trim()) {
    parts.push(`**Повторный приём:** ${input.followUp.trim()}`);
    parts.push("");
  } else if (prescriptions.length > 0 || advice.length > 0) {
    parts.push(
      "**Когда прийти ещё раз:** при ухудшении самочувствия — сразу, иначе на контрольный приём по согласованию с врачом.",
    );
    parts.push("");
  }

  // ── Closing ────────────────────────────────────────────
  parts.push("Берегите себя!");
  if (input.doctorName?.trim() || input.clinicName?.trim()) {
    parts.push("");
    const sigBits: string[] = [];
    if (input.doctorName?.trim()) {
      sigBits.push(input.doctorName.trim());
    }
    if (input.doctorSpecialty?.trim()) {
      sigBits.push(input.doctorSpecialty.trim());
    }
    if (input.clinicName?.trim()) {
      sigBits.push(input.clinicName.trim());
    }
    parts.push(`— ${sigBits.join(", ")}`);
  }

  return parts.join("\n").trim() + "\n";
}
