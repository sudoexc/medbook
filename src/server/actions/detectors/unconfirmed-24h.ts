/**
 * Detector: UNCONFIRMED_24H.
 *
 * Picks BOOKED appointments inside the next `unconfirmedHoursAhead` hours and
 * emits one action per appointment. The schema has no `confirmedAt` column,
 * so "unconfirmed" is approximated as `status === 'BOOKED'` — once the
 * patient calls or replies the front-desk flips status to WAITING. See the
 * Wave 2 hand-off note about this gap; Wave 3 may add a structured confirm
 * flag.
 *
 * Severity scales with proximity to the appointment:
 *   - `high`   when start is < 2h away
 *   - `medium` when 2h ≤ start < 12h
 *   - `low`    when ≥ 12h
 *
 * `expiresAt` is set to the appointment start so the action self-clears once
 * the visit happens or is cancelled.
 */
import type { ActionSeverity, Unconfirmed24hPayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { addHours } from "./_shared";

type ApptRow = {
  id: string;
  date: Date;
  patientId: string;
  patient: { fullName: string };
  doctor: { nameRu: string };
};

export async function detectUnconfirmed24h(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<Unconfirmed24hPayload[]> {
  const horizon = addHours(now, config.unconfirmedHoursAhead);

  const rows = (await prisma.appointment.findMany({
    where: {
      status: "BOOKED",
      date: { gte: now, lte: horizon },
    },
    select: {
      id: true,
      date: true,
      patientId: true,
      patient: { select: { fullName: true } },
      doctor: { select: { nameRu: true } },
    },
  })) as ApptRow[];

  return rows.map((r) => ({
    type: "UNCONFIRMED_24H",
    appointmentId: r.id,
    patientId: r.patientId,
    patientName: r.patient.fullName,
    appointmentAt: r.date.toISOString(),
    doctorName: r.doctor.nameRu,
  }));
}

export function severityForUnconfirmed24h(
  payload: Unconfirmed24hPayload,
  now: Date,
): ActionSeverity {
  const hoursUntil =
    (new Date(payload.appointmentAt).getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hoursUntil < 2) return "high";
  if (hoursUntil < 12) return "medium";
  return "low";
}
