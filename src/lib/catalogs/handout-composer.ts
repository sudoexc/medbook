/**
 * Patient handout composer — deterministic, no LLM.
 *
 * Takes the structured fields of a VisitNote (plus the matched
 * DiagnosisGuide blocks, Ф1) and produces a friendly, patient-facing
 * Markdown document ready to print. The composer never inserts ICD-10
 * codes or technical jargon — only what the patient actually needs to
 * act on at home.
 *
 * Composition contract:
 *   - Output is Markdown so it renders both in our print template and as
 *     a textarea preview, and the doctor can edit it freely.
 *   - Sections without data are dropped entirely (no "Жалобы: —").
 *   - Order is fixed: greeting → diagnosis → what-to-do (guide) →
 *     prescriptions → care/lifestyle (guide) → advice → red flags (guide)
 *     → follow-up → closing. Doctor edits manually if they want otherwise.
 *   - RU and UZ are full peers — every static string lives in STRINGS.
 *     The caller resolves which guide-language blocks to pass (Uz with Ru
 *     fallback), so the composer stays ignorant of the guide schema.
 */

export type HandoutLocale = "ru" | "uz";

/** Locale-resolved guide blocks (Ф1) — caller picks Uz/Ru text upstream. */
export type HandoutGuideBlocks = {
  whatToDo?: string | null;
  care?: string | null;
  lifestyle?: string | null;
  redFlags?: string | null;
};

export type HandoutInput = {
  locale?: HandoutLocale;
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
  /** Knowledge-base blocks for the active diagnosis (Ф1). */
  guide?: HandoutGuideBlocks | null;
  /** Follow-up note shown near the end. Free text. */
  followUp?: string | null;
  /** Concrete control-visit date (Ф6) — wins over the generic fallback. */
  followUpDate?: Date | null;
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

const UZ_MONTHS = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentyabr",
  "oktyabr",
  "noyabr",
  "dekabr",
];

function formatDate(d: Date, locale: HandoutLocale): string {
  if (locale === "uz") {
    return `${d.getFullYear()}-yil ${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`;
  }
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const STRINGS = {
  ru: {
    title: "# Памятка для пациента",
    greeting: (name: string | null) =>
      name ? `Здравствуйте, ${name}!` : "Здравствуйте!",
    introWithDate: (date: string) => `По итогам приёма от ${date}`,
    introToday: "По итогам сегодняшнего приёма",
    introDoctor: (doctor: string) => `у врача ${doctor}`,
    introTail: "подготовлены следующие рекомендации:",
    diagnosis: "**Диагноз:**",
    complaints: "**Жалобы, с которыми вы обратились:**",
    whatToDo: "**Что делать:**",
    prescriptions: "**Назначения — что и как принимать:**",
    prescriptionsCaution:
      "_Принимайте препараты строго по схеме. Если появятся побочные эффекты — свяжитесь с клиникой или вашим врачом._",
    care: "**Уход и режим:**",
    lifestyle: "**Образ жизни и диета:**",
    advice: "**Рекомендации по образу жизни и уходу:**",
    redFlags: "**Срочно обратитесь к врачу, если:**",
    followUp: "**Повторный приём:**",
    followUpFallback:
      "**Когда прийти ещё раз:** при ухудшении самочувствия — сразу, иначе на контрольный приём по согласованию с врачом.",
    closing: "Берегите себя!",
  },
  uz: {
    title: "# Bemor uchun eslatma",
    greeting: (name: string | null) =>
      name ? `Assalomu alaykum, ${name}!` : "Assalomu alaykum!",
    introWithDate: (date: string) =>
      `${date} kungi qabul yakunlari bo‘yicha`,
    introToday: "Bugungi qabul yakunlari bo‘yicha",
    introDoctor: (doctor: string) => `shifokor ${doctor} tomonidan`,
    introTail: "quyidagi tavsiyalar tayyorlandi:",
    diagnosis: "**Tashxis:**",
    complaints: "**Siz murojaat qilgan shikoyatlar:**",
    whatToDo: "**Nima qilish kerak:**",
    prescriptions: "**Dori-darmonlar — nimani va qanday qabul qilish:**",
    prescriptionsCaution:
      "_Dorilarni qat’iy jadval bo‘yicha qabul qiling. Nojo‘ya ta’sirlar paydo bo‘lsa — klinika yoki shifokoringizga murojaat qiling._",
    care: "**Parvarish va tartib:**",
    lifestyle: "**Turmush tarzi va parhez:**",
    advice: "**Turmush tarzi va parvarish bo‘yicha tavsiyalar:**",
    redFlags: "**Zudlik bilan shifokorga murojaat qiling, agar:**",
    followUp: "**Qayta qabul:**",
    followUpFallback:
      "**Yana qachon kelish kerak:** ahvolingiz yomonlashsa — darhol, aks holda shifokor bilan kelishilgan nazorat qabuliga.",
    closing: "O‘zingizni asrang!",
  },
} as const;

export type HandoutGuideSection = keyof HandoutGuideBlocks;

/**
 * Bold Markdown header for a guide section — exported so the guide card's
 * per-section «Вставить в памятку» writes the exact same header the full
 * composer would, keeping mixed documents consistent.
 */
export function handoutSectionTitle(
  locale: HandoutLocale,
  section: HandoutGuideSection,
): string {
  return STRINGS[locale === "uz" ? "uz" : "ru"][section];
}

/**
 * Compose a patient handout in Markdown from the structured visit note.
 * Returns an empty string when there's nothing meaningful to print
 * (no complaints + no prescriptions + no advice + no diagnosis + no guide).
 */
export function composePatientHandout(input: HandoutInput): string {
  const locale: HandoutLocale = input.locale === "uz" ? "uz" : "ru";
  const s = STRINGS[locale];

  const complaints = (input.complaints ?? []).filter(Boolean);
  const prescriptions = (input.prescriptions ?? []).filter(Boolean);
  const advice = (input.advice ?? []).filter(Boolean);
  const guide = input.guide ?? null;
  const guideWhatToDo = guide?.whatToDo?.trim() || null;
  const guideCare = guide?.care?.trim() || null;
  const guideLifestyle = guide?.lifestyle?.trim() || null;
  const guideRedFlags = guide?.redFlags?.trim() || null;
  const hasGuide = Boolean(
    guideWhatToDo || guideCare || guideLifestyle || guideRedFlags,
  );

  const hasContent =
    complaints.length > 0 ||
    prescriptions.length > 0 ||
    advice.length > 0 ||
    hasGuide ||
    !!input.diagnosisName?.trim();

  if (!hasContent) return "";

  const parts: string[] = [];

  // ── Header ─────────────────────────────────────────────
  const firstName = input.patientName?.trim().split(/\s+/)[0] ?? "";
  parts.push(s.title);
  parts.push("");
  parts.push(s.greeting(firstName || null));
  parts.push("");

  // ── Intro line ─────────────────────────────────────────
  const dateStr = input.visitDate ? formatDate(input.visitDate, locale) : null;
  const introBits: string[] = [];
  introBits.push(dateStr ? s.introWithDate(dateStr) : s.introToday);
  if (input.doctorName?.trim()) {
    introBits.push(s.introDoctor(input.doctorName.trim()));
  }
  introBits.push(s.introTail);
  parts.push(introBits.join(" "));
  parts.push("");

  // ── Diagnosis (no МКБ code) ────────────────────────────
  if (input.diagnosisName?.trim()) {
    parts.push(`${s.diagnosis} ${input.diagnosisName.trim()}`);
    parts.push("");
  }

  // ── Complaints — shown as a brief "as you described" line ─
  if (complaints.length > 0) {
    parts.push(s.complaints);
    parts.push(complaints.map((c) => `- ${c}`).join("\n"));
    parts.push("");
  }

  // ── Guide: action plan ─────────────────────────────────
  if (guideWhatToDo) {
    parts.push(s.whatToDo);
    parts.push(guideWhatToDo);
    parts.push("");
  }

  // ── Prescriptions ──────────────────────────────────────
  if (prescriptions.length > 0) {
    parts.push(s.prescriptions);
    parts.push(prescriptions.map((p) => `- ${p}`).join("\n"));
    parts.push("");
    parts.push(s.prescriptionsCaution);
    parts.push("");
  }

  // ── Guide: care + lifestyle ────────────────────────────
  if (guideCare) {
    parts.push(s.care);
    parts.push(guideCare);
    parts.push("");
  }
  if (guideLifestyle) {
    parts.push(s.lifestyle);
    parts.push(guideLifestyle);
    parts.push("");
  }

  // ── Advice / lifestyle chips ───────────────────────────
  if (advice.length > 0) {
    parts.push(s.advice);
    parts.push(advice.map((a) => `- ${a}`).join("\n"));
    parts.push("");
  }

  // ── Guide: red flags ───────────────────────────────────
  if (guideRedFlags) {
    parts.push(s.redFlags);
    parts.push(guideRedFlags);
    parts.push("");
  }

  // ── Follow-up ──────────────────────────────────────────
  if (input.followUpDate) {
    parts.push(`${s.followUp} ${formatDate(input.followUpDate, locale)}`);
    parts.push("");
  } else if (input.followUp?.trim()) {
    parts.push(`${s.followUp} ${input.followUp.trim()}`);
    parts.push("");
  } else if (prescriptions.length > 0 || advice.length > 0 || hasGuide) {
    parts.push(s.followUpFallback);
    parts.push("");
  }

  // ── Closing ────────────────────────────────────────────
  parts.push(s.closing);
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
