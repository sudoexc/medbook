/**
 * Sample render contexts — keyed by logical trigger key — used by the live
 * preview pane in the settings template editor.
 *
 * Values mirror the canonical `RenderCtx` shape produced by triggers.ts so
 * the preview shows realistic substitution.
 */
import type { LogicalTriggerKey } from "@/server/notifications/rules";

export type PreviewLang = "ru" | "uz";

const RU_SAMPLE = {
  patient: {
    name: "Анна Петрова",
    firstName: "Анна",
    phone: "+998 90 123 45 67",
  },
  appointment: {
    date: "15 мая 2026",
    time: "14:30",
    doctor: "Каримов Б.А.",
    service: "Консультация невролога",
    cabinet: "204",
  },
  payment: {
    amount: "350 000",
    currency: "UZS",
  },
  clinic: {
    name: "NeuroFax",
    phone: "+998 71 200 00 00",
    address: "г. Ташкент, ул. Амира Темура 5",
  },
};

const UZ_SAMPLE = {
  patient: {
    name: "Anna Petrova",
    firstName: "Anna",
    phone: "+998 90 123 45 67",
  },
  appointment: {
    date: "2026-yil 15-may",
    time: "14:30",
    doctor: "Karimov B.A.",
    service: "Nevrolog konsultatsiyasi",
    cabinet: "204",
  },
  payment: {
    amount: "350 000",
    currency: "UZS",
  },
  clinic: {
    name: "NeuroFax",
    phone: "+998 71 200 00 00",
    address: "Toshkent, Amir Temur 5",
  },
};

/**
 * Pick the right sample for a (logical trigger, language) pair. We currently
 * use the same payload for every trigger because triggers.ts populates the
 * same RenderCtx shape — extending later (per-trigger nuance) is trivial.
 */
export function previewContextFor(
  _logical: LogicalTriggerKey,
  lang: PreviewLang,
): Record<string, unknown> {
  return lang === "uz" ? UZ_SAMPLE : RU_SAMPLE;
}
