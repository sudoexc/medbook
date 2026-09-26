/**
 * The only shape of an appointment the Mini App (patient-facing) API returns
 * (audit MA-10).
 *
 * The list route used to `include` relations and spread the whole row into
 * the response, so every scalar column reached the patient's device: the
 * reception note the CRM drawer saves in `comments` («конфликтный, долг…»),
 * staff `notes`, `cancelReason`/`cancelledBy`, `createdById`, `leadId`,
 * `confirmedBy`, `preVisitData`, the discount breakdown. The reschedule and
 * cancel routes did the same with the row the shared kernels return. Anyone
 * can read a response in Telegram Desktop's DevTools.
 *
 * So the routes select, or pick, exactly these fields. A new column stays
 * internal until someone adds it here on purpose.
 */
import type { Prisma } from "@/generated/prisma/client";

/** Scalar columns a patient may see about their own visit. */
export const MINIAPP_APPOINTMENT_SCALARS = {
  id: true,
  date: true,
  endDate: true,
  time: true,
  ticketCode: true,
  durationMin: true,
  status: true,
  channel: true,
  priceFinal: true,
  arrivedAt: true,
} as const satisfies Prisma.AppointmentSelect;

/** Select for the list: patient-safe scalars plus the relations the screens render. */
export const MINIAPP_APPOINTMENT_SELECT = {
  ...MINIAPP_APPOINTMENT_SCALARS,
  doctor: {
    select: {
      id: true,
      nameRu: true,
      nameUz: true,
      specializationRu: true,
      specializationUz: true,
      photoUrl: true,
    },
  },
  cabinet: { select: { id: true, number: true } },
  primaryService: { select: { id: true, nameRu: true, nameUz: true } },
  services: {
    select: {
      service: {
        select: { id: true, nameRu: true, nameUz: true, priceBase: true },
      },
    },
  },
  payments: { select: { id: true, amount: true, status: true, method: true } },
  // P1.1: a finalized visit note may carry an auto-generated CONCLUSION
  // document, linked straight from the past-visit detail. Ф6: followUpDays /
  // finalizedAt feed the «book a control visit» CTA (date only; the doctor's
  // followUpNote is reception-internal). Consumed by the route, never sent.
  visitNote: {
    select: {
      followUpDays: true,
      finalizedAt: true,
      conclusionDocument: { select: { id: true } },
    },
  },
} as const satisfies Prisma.AppointmentSelect;

type ScalarKey = keyof typeof MINIAPP_APPOINTMENT_SCALARS;
export type MiniAppAppointmentSummary = Pick<
  Prisma.AppointmentGetPayload<{ select: typeof MINIAPP_APPOINTMENT_SCALARS }>,
  ScalarKey
>;

/**
 * Patient-safe scalars of a full appointment row, for the PATCH / DELETE
 * responses (the cancel kernel and the reschedule update return every column).
 */
export function toMiniAppAppointmentSummary(
  row: MiniAppAppointmentSummary,
): MiniAppAppointmentSummary {
  return {
    id: row.id,
    date: row.date,
    endDate: row.endDate,
    time: row.time,
    ticketCode: row.ticketCode,
    durationMin: row.durationMin,
    status: row.status,
    channel: row.channel,
    priceFinal: row.priceFinal,
    arrivedAt: row.arrivedAt,
  };
}
