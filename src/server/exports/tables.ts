/**
 * The three staff CSV exports (patients, appointments, payments), shared by
 * the export worker and the streaming `/api/crm/patients/export` (audit
 * PT-19, INF-02).
 *
 * - Filters: the same WHERE as the list on screen (`buildPatientListWhere`,
 *   `appointmentSearchOr`), so the file is what the admin was looking at.
 * - Paging: keyset over a unique order. `orderBy: { date }` with
 *   `cursor: { id }` is not a total order (ten visits at 09:00 share a
 *   date), and Prisma's cursor then lost or repeated rows at page edges;
 *   `id` breaks every tie now.
 * - Money in сум (dollars for USD payments), not тийин: `moneyCell`.
 * - Patients: no erased (DSAR) cards; the balance column only when the
 *   clinic records payments, otherwise no honest figure exists.
 */
import { prisma } from "@/lib/prisma";
import { tashkentDayWindow, isTashkentDateString } from "@/lib/tashkent-time";
import { appointmentSearchOr } from "@/server/appointments/list-where";
import { clinicPatientBalances } from "@/server/patient/finance";
import {
  buildPatientListWhere,
  type PatientListFilterInput,
} from "@/server/patient/list-where";

import { csvHeader, csvRow, moneyCell } from "./csv";

export const EXPORT_PAGE = 500;

type Write = (chunk: string) => void;

export type AppointmentExportFilters = {
  q?: string;
  doctorId?: string;
  cabinetId?: string;
  channel?: string;
  status?: string;
  /** Several statuses at once (the «Пришли» tile: on the table + done). */
  statuses?: string[];
  unpaid?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

export type PaymentExportFilters = {
  paidOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

/**
 * A period bound as an instant: a Tashkent day (the whole day, inclusive at
 * both ends) or an ISO instant. Garbage reads as «no bound» rather than an
 * Invalid Date that fails the whole export.
 */
export function periodBound(
  value: string | undefined,
  side: "from" | "to",
): Date | null {
  if (!value) return null;
  if (isTashkentDateString(value)) {
    const day = tashkentDayWindow(value);
    return side === "from" ? day.from : day.to;
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function range(from: string | undefined, to: string | undefined) {
  const gte = periodBound(from, "from");
  const lte = periodBound(to, "to");
  if (!gte && !lte) return null;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

/**
 * Keyset pages over `findMany` with a unique order: every row exactly once.
 */
async function eachPage<T extends { id: string }>(
  fetch: (cursor: string | undefined) => Promise<T[]>,
  onRow: (row: T) => void,
): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  while (true) {
    const batch = await fetch(cursor);
    if (batch.length === 0) break;
    for (const row of batch) {
      onRow(row);
      count += 1;
    }
    cursor = batch[batch.length - 1]?.id;
    if (batch.length < EXPORT_PAGE) break;
  }
  return count;
}

const PATIENT_COLS = [
  "id",
  "fullName",
  "phone",
  "gender",
  "birthDate",
  "segment",
  "source",
  "ltv_sum",
  "visitsCount",
  "balance_sum",
  "lastVisitAt",
  "tags",
  "createdAt",
] as const;

export async function writePatientsCsv(
  filters: PatientListFilterInput,
  clinicId: string | null,
  write: Write,
): Promise<number> {
  const where = await buildPatientListWhere(filters, clinicId);
  const balances = clinicId ? await clinicPatientBalances(clinicId) : null;
  const cols = balances
    ? PATIENT_COLS
    : PATIENT_COLS.filter((c) => c !== "balance_sum");
  write(csvHeader(cols));
  return eachPage(
    (cursor) =>
      prisma.patient.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: EXPORT_PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          fullName: true,
          phone: true,
          gender: true,
          birthDate: true,
          segment: true,
          source: true,
          ltv: true,
          visitsCount: true,
          lastVisitAt: true,
          tags: true,
          createdAt: true,
        },
      }),
    (p) => {
      const cells: Record<(typeof PATIENT_COLS)[number], unknown> = {
        id: p.id,
        fullName: p.fullName,
        phone: p.phone,
        gender: p.gender,
        birthDate: p.birthDate,
        segment: p.segment,
        source: p.source,
        ltv_sum: moneyCell(p.ltv),
        visitsCount: p.visitsCount,
        balance_sum: balances ? moneyCell(balances.get(p.id) ?? 0) : null,
        lastVisitAt: p.lastVisitAt,
        tags: p.tags,
        createdAt: p.createdAt,
      };
      write(csvRow(cols.map((c) => cells[c])));
    },
  );
}

const APPOINTMENT_COLS = [
  "id",
  "date",
  "status",
  "doctorId",
  "patientId",
  "serviceId",
  "channel",
  "priceFinal_sum",
  "createdAt",
] as const;

export function appointmentExportWhere(
  f: AppointmentExportFilters,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.doctorId) where.doctorId = f.doctorId;
  if (f.cabinetId) where.cabinetId = f.cabinetId;
  if (f.channel) where.channel = f.channel;
  if (f.statuses && f.statuses.length > 0) where.status = { in: f.statuses };
  else if (f.status) where.status = f.status;
  if (f.unpaid) where.payments = { none: { status: "PAID" } };
  const date = range(f.dateFrom, f.dateTo);
  if (date) where.date = date;
  const searchOr = appointmentSearchOr(f.q);
  if (searchOr) where.OR = searchOr;
  return where;
}

export async function writeAppointmentsCsv(
  filters: AppointmentExportFilters,
  write: Write,
): Promise<number> {
  const where = appointmentExportWhere(filters);
  write(csvHeader(APPOINTMENT_COLS));
  return eachPage(
    (cursor) =>
      prisma.appointment.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: EXPORT_PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          date: true,
          status: true,
          doctorId: true,
          patientId: true,
          serviceId: true,
          channel: true,
          priceFinal: true,
          createdAt: true,
        },
      }),
    (a) =>
      write(
        csvRow([
          a.id,
          a.date,
          a.status,
          a.doctorId,
          a.patientId,
          a.serviceId,
          a.channel,
          moneyCell(a.priceFinal),
          a.createdAt,
        ]),
      ),
  );
}

const PAYMENT_COLS = [
  "id",
  "appointmentId",
  "patientId",
  // In the payment's currency (сум or dollars), not тийин / cents.
  "amount",
  "currency",
  "method",
  "status",
  "paidAt",
  "createdAt",
] as const;

export async function writePaymentsCsv(
  filters: PaymentExportFilters,
  write: Write,
): Promise<number> {
  const where: Record<string, unknown> = {};
  if (filters.paidOnly) where.status = "PAID";
  const paidAt = range(filters.dateFrom, filters.dateTo);
  if (paidAt) where.paidAt = paidAt;
  write(csvHeader(PAYMENT_COLS));
  return eachPage(
    (cursor) =>
      prisma.payment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: EXPORT_PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          appointmentId: true,
          patientId: true,
          amount: true,
          currency: true,
          method: true,
          status: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    (p) =>
      write(
        csvRow([
          p.id,
          p.appointmentId,
          p.patientId,
          moneyCell(p.amount),
          p.currency,
          p.method,
          p.status,
          p.paidAt,
          p.createdAt,
        ]),
      ),
  );
}
