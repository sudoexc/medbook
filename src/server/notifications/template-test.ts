/**
 * «Тестовая отправка» of a notification template (audit UX-10).
 *
 * The editor used to POST a NotificationSend for patientId
 * "dev-fake-patient" to «+998000000000»: the patient foreign key refused it
 * and the admin got a 500 with Prisma's text, on every template. Now the
 * saved template goes to the admin himself, in his own Telegram chat with
 * the clinic bot, rendered and sent exactly like the worker sends a real
 * one (HTML-escaped values, parse_mode HTML). Nothing is written to
 * NotificationSend: a test is no delivery to a patient and must not show in
 * the activity list or the counters.
 *
 * Fails safe: no bot, no Telegram on the staff account, or a channel the
 * worker cannot deliver is a clear refusal, never a fake «sent».
 */
import { z } from "zod";

import { tgFailReason } from "@/server/telegram/send-errors";

const sampleText = z.string().max(200);

/** Body of POST /api/crm/notifications/templates/[id]/test-send. */
export const TemplateTestSendSchema = z.object({
  locale: z.enum(["ru", "uz"]).default("ru"),
  /** The editor preview's sample patient and visit, in the admin's language. */
  sample: z
    .object({
      patient: z
        .object({ name: sampleText, firstName: sampleText, phone: sampleText })
        .partial()
        .optional(),
      appointment: z
        .object({
          date: sampleText,
          time: sampleText,
          doctor: sampleText,
          service: sampleText,
          cabinet: sampleText,
        })
        .partial()
        .optional(),
      payment: z.object({ amount: sampleText, currency: sampleText }).partial().optional(),
    })
    .default({}),
});

export type TemplateTestSample = z.infer<typeof TemplateTestSendSchema>["sample"];

export type TemplateTestRefusal =
  /** Only Telegram templates are delivered by the worker today. */
  | "channel_not_supported"
  /** The clinic has no bot token: nothing could carry the message. */
  | "bot_not_connected"
  /** The staff account has no Telegram id to send to. */
  | "no_staff_telegram";

export function templateTestRefusal(input: {
  channel: string;
  botConnected: boolean;
  staffTelegramId: string | null | undefined;
}): TemplateTestRefusal | null {
  if (input.channel !== "TG") return "channel_not_supported";
  if (!input.botConnected) return "bot_not_connected";
  if (!input.staffTelegramId?.trim()) return "no_staff_telegram";
  return null;
}

/**
 * Render context: the editor's sample patient and visit, the clinic's real
 * name, phone and address (what the patient would see).
 */
export function templateTestContext(
  sample: TemplateTestSample,
  clinic: {
    nameRu: string;
    nameUz: string | null;
    phone: string | null;
    addressRu: string | null;
  },
  lang: "ru" | "uz",
): Record<string, unknown> {
  return {
    patient: sample.patient ?? {},
    appointment: sample.appointment ?? {},
    payment: sample.payment ?? {},
    clinic: {
      name: lang === "uz" && clinic.nameUz ? clinic.nameUz : clinic.nameRu,
      phone: clinic.phone ?? "",
      address: clinic.addressRu ?? "",
    },
  };
}

export type TemplateTestFailure =
  /** He never pressed «Старт» in the clinic bot: a bot may not write first. */
  | "staff_not_started_bot"
  /** He blocked the bot, or the chat does not exist. */
  | "staff_blocked_bot"
  /** No answer from Telegram: the message may have arrived. */
  | "tg_timeout"
  | "tg_error";

/** What a failed Telegram send means for the admin (HTTP status + reason). */
export function templateTestFailure(message: string): {
  status: 409 | 502;
  reason: TemplateTestFailure;
} {
  switch (tgFailReason(message)) {
    case "tg_not_started":
      return { status: 409, reason: "staff_not_started_bot" };
    case "tg_blocked":
      return { status: 409, reason: "staff_blocked_bot" };
    case "tg_timeout":
      return { status: 502, reason: "tg_timeout" };
    default:
      return { status: 502, reason: "tg_error" };
  }
}
