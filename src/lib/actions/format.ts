/**
 * Pure helpers that turn an `ActionPayload` into UI strings — title + body —
 * by delegating to next-intl translators.
 *
 * Why pure: we want the same formatter to render an action card on the Action
 * Center page, the reception briefing, and (eventually) the email/Mini App
 * surfaces, without each call site reimplementing payload→string interpolation.
 *
 * The helpers accept a `t`-shaped function (anything with a callable signature
 * `t(key, values?) => string`). They never reach into next-intl directly so
 * the unit tests can pass a plain stub.
 *
 * Currency convention: any `*Uzs` field on the payload is in tiins (UZS minor
 * units). We pass it through `formatMoney(..., "UZS", locale)` before
 * interpolation so message bundles stay locale-agnostic.
 *
 * The body may legitimately be empty for terse types (e.g. OVERDUE_FOLLOW_UP
 * has all signal in the title) — callers should treat empty string as "no
 * secondary line" rather than "missing translation".
 */
import { formatMoney, type Locale } from "@/lib/format";
import type { ActionPayload } from "@/lib/actions/types";

/**
 * Minimal `t`-shape we need. We deliberately accept the next-intl translator's
 * narrower value type (string | number | Date) so a real translator from
 * `useTranslations()` can be passed without a cast. Tests can pass a plain
 * function with the same signature.
 */
export type Translator = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/**
 * Render a short HH:MM in 24h time. Locale-agnostic by design — the wider
 * action card already uses ru-RU/uz-Latn for relative timestamps; the slot
 * time inside the title is just a clock readout.
 */
function formatHM(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Locale-aware short date "DD.MM" — used in titles where we want "10.05" not
 * the full "2026-05-10" string. Falls back to the raw input on parse failure.
 */
function formatDM(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const intlLocale = locale === "uz" ? "uz-Latn-UZ" : "ru-RU";
  return new Intl.DateTimeFormat(intlLocale, {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

/**
 * Build the values bag for a payload. Centralising here keeps the title/body
 * formatters in lockstep — both pull from the same set of placeholders, so
 * the two i18n strings can mix-and-match without surprises.
 */
function valuesFor(
  payload: ActionPayload,
  locale: Locale,
): Record<string, string | number> {
  switch (payload.type) {
    case "EMPTY_SLOT_TOMORROW":
      return {
        doctorName: payload.doctorName,
        slotTime: formatHM(payload.slotStart),
        slotDate: formatDM(payload.slotStart, locale),
        specialty: payload.specialty,
        revenueLoss: formatMoney(payload.estimatedRevenueLossUzs, "UZS", locale),
      };
    case "DORMANT_BATCH":
      return {
        segment: payload.segment,
        patientCount: payload.patientCount,
      };
    case "UNCONFIRMED_24H":
      return {
        patientName: payload.patientName,
        doctorName: payload.doctorName,
        slotTime: formatHM(payload.appointmentAt),
        slotDate: formatDM(payload.appointmentAt, locale),
      };
    case "NO_SHOW_RISK_HIGH":
      return {
        patientName: payload.patientName,
        riskPct: Math.round(payload.risk * 100),
        slotTime: formatHM(payload.appointmentAt),
      };
    case "CASE_REPEAT_DUE":
      return {
        patientName: payload.patientName,
        dueDate: formatDM(payload.dueDate, locale),
      };
    case "OVERDUE_FOLLOW_UP":
      return {
        daysSinceVisit: payload.daysSinceVisit,
      };
    case "DOCTOR_OVERLOAD":
      return {
        doctorName: payload.doctorName,
        queueLength: payload.queueLength,
        alternativeCount: payload.alternativeDoctorIds.length,
      };
    case "IDLE_ROOM":
      return {
        cabinetName: payload.cabinetName,
        idleMinutes: payload.idleMinutes,
        queueLength: payload.queueLength,
      };
    case "PAYMENT_OVERDUE":
      return {
        patientName: payload.patientName,
        amount: formatMoney(payload.amountUzs, "UZS", locale),
        daysOverdue: payload.daysOverdue,
      };
    case "LOW_DOCTOR_SCHEDULE":
      return {
        doctorName: payload.doctorName,
        slotsNext7Days: payload.slotsNext7Days,
      };
    case "LOW_NPS_RECEIVED":
      return {
        patientName: payload.patientName,
        doctorName: payload.doctorName,
        score: payload.score,
        commentPreview: payload.commentPreview,
      };
    default: {
      const _exhaustive: never = payload;
      throw new Error(
        `valuesFor: unhandled payload type ${(_exhaustive as { type: string }).type}`,
      );
    }
  }
}

/**
 * Render the title for an action card.
 *
 * `t` is a translator scoped to `actionCenter.types.<TYPE>` OR the global
 * translator — we accept either by passing the full `actionCenter.types.<T>.title`
 * key. The default uses the global form so callers don't need to scope the
 * translator per row.
 */
export function formatActionTitle(
  t: Translator,
  payload: ActionPayload,
  locale: Locale = "ru",
): string {
  return t(`actionCenter.types.${payload.type}.title`, valuesFor(payload, locale));
}

/**
 * Render the body for an action card. Returns an empty string if the bundle
 * has no body for this type (next-intl returns the raw key when missing —
 * callers should treat that as no body and skip the row, but in practice
 * every type ships with both title + body).
 */
export function formatActionBody(
  t: Translator,
  payload: ActionPayload,
  locale: Locale = "ru",
): string {
  return t(`actionCenter.types.${payload.type}.body`, valuesFor(payload, locale));
}
