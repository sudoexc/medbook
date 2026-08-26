/**
 * "Вас вызывают" Telegram push — the one place that composes and sends the
 * patient-facing call notice.
 *
 * Why it exists: the patient can be summoned from two desks — the doctor
 * cabinet (`PATCH /api/crm/appointments/[id]?call=true`) and the reception
 * queue panel (`PATCH /api/crm/appointments/[id]/queue-status` →
 * IN_PROGRESS). Until now only the doctor path pushed, so a patient called by
 * reception learned about it from a 20-second poll — i.e. not at all if the
 * app was closed. Keeping the copy + the swallow-errors policy in a single
 * module means the two call sites can never drift apart again.
 *
 * Copy lives here rather than in `src/messages/*.json` for the same reason as
 * `telegram/messages.ts`: the send can happen far from a next-intl request
 * scope (queue worker, webhook), and the bot dictionary is the established
 * home for outbound bot copy. Language follows `Patient.preferredLang`.
 *
 * Never throws: a failed push must not roll back or 500 a lifecycle write
 * that already committed. The boolean result is what the caller audits.
 */
import { escapeHtml } from "@/lib/telegram";
import { sendMessage, type TgClinicMinimal } from "@/server/telegram/send";

export type CallNoticeLang = "RU" | "UZ";

export type SendCallNoticeInput = {
  clinic: TgClinicMinimal;
  /** Patient's Telegram chat id; null/empty means "no linked account" → skip. */
  telegramId: string | null | undefined;
  /** Cabinet number to walk to, when the doctor has one assigned. */
  cabinetNumber?: string | null;
  /** Doctor display name in the patient's language. */
  doctorName?: string | null;
  /** `Patient.preferredLang`; defaults to RU like the rest of the bot. */
  lang?: CallNoticeLang | null;
  /** Log tag so the two call sites stay distinguishable in prod logs. */
  logTag?: string;
};

type Copy = {
  title: string;
  cabinet: (n: string) => string;
  /** Fallback when the doctor has no cabinet assigned. */
  noCabinet: string;
  doctor: (name: string) => string;
};

const COPY: Record<CallNoticeLang, Copy> = {
  RU: {
    title: "📢 <b>Вас вызывают!</b>",
    cabinet: (n) => `Кабинет ${n}`,
    noCabinet: "Подойдите к врачу",
    doctor: (name) => `Врач: ${name}`,
  },
  UZ: {
    title: "📢 <b>Sizni chaqirishmoqda!</b>",
    cabinet: (n) => `${n}-xona`,
    noCabinet: "Shifokor oldiga o'ting",
    doctor: (name) => `Shifokor: ${name}`,
  },
};

/**
 * Build the HTML body of the call notice. Exported for unit tests and so a
 * caller can log/preview the text without sending.
 */
export function buildCallNoticeText(input: {
  cabinetNumber?: string | null;
  doctorName?: string | null;
  lang?: CallNoticeLang | null;
}): string {
  const copy = COPY[input.lang ?? "RU"] ?? COPY.RU;
  const cabinet = input.cabinetNumber?.trim();
  const location = cabinet
    ? copy.cabinet(escapeHtml(cabinet))
    : copy.noCabinet;
  const doctor = input.doctorName?.trim();
  const doctorLine = doctor ? `\n${copy.doctor(escapeHtml(doctor))}` : "";
  return `${copy.title}\n\n${location}${doctorLine}`;
}

/**
 * Send the notice. Returns `true` only when Telegram accepted the message —
 * that's the value the callers stamp into the audit log as `notificationSent`.
 */
export async function sendCallNotice(
  input: SendCallNoticeInput,
): Promise<boolean> {
  if (!input.telegramId) return false;
  const text = buildCallNoticeText(input);
  try {
    await sendMessage(input.clinic, input.telegramId, text, {
      parse_mode: "HTML",
    });
    return true;
  } catch (e) {
    console.error(`[${input.logTag ?? "call-notice"}] telegram`, e);
    return false;
  }
}
