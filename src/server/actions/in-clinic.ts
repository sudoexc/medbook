/**
 * Retire the no-show / confirmation rows of patients who have already arrived
 * (audit AC-07).
 *
 * NO_SHOW_RISK_HIGH and UNCONFIRMED_24H are about a patient who might not
 * come. Once reception presses «Пришёл» (WAITING) or the doctor starts the
 * visit (IN_PROGRESS) the question is answered, yet the row stayed OPEN: the
 * detectors stop firing, but NO_SHOW_RISK_HIGH only expires at the visit time
 * and UNCONFIRMED_24H only through the 48h sweep. Until then the patient
 * sitting in the hall was a «Риск пропуска» card, a KPI count and a
 * suggested call.
 *
 * Rows with a recorded call outcome are left alone: they are a person's
 * record of the call and feed «Обработано сегодня».
 *
 * Caller MUST be inside `runWithTenant(...)` (the engine is).
 */
import {
  IN_CLINIC_APPOINTMENT_STATUSES,
  type ActionPayload,
} from "@/lib/actions/types";
import type { TenantScopedPrisma } from "@/lib/prisma";

import { retireActions } from "./repository";

type PrismaLike = TenantScopedPrisma;

/** The appointment-bound signals that only mean something before arrival. */
const PRE_ARRIVAL_TYPES = ["NO_SHOW_RISK_HIGH", "UNCONFIRMED_24H"] as const;

export async function retireInClinicRiskActions(
  prisma: PrismaLike,
  clinicId: string,
): Promise<number> {
  const live = (await prisma.action.findMany({
    where: {
      clinicId,
      type: { in: [...PRE_ARRIVAL_TYPES] },
      status: { in: ["OPEN", "SNOOZED"] },
      outcome: null,
    },
    select: { id: true, type: true, severity: true, status: true, payload: true },
  })) as Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    payload: ActionPayload | null;
  }>;
  if (live.length === 0) return 0;

  const apptIdOf = (p: ActionPayload | null): string | null =>
    p && "appointmentId" in p && typeof p.appointmentId === "string"
      ? p.appointmentId
      : null;
  const apptIds = [...new Set(live.map((a) => apptIdOf(a.payload)).filter(Boolean))] as string[];
  if (apptIds.length === 0) return 0;

  const arrived = (await prisma.appointment.findMany({
    where: {
      id: { in: apptIds },
      status: { in: [...IN_CLINIC_APPOINTMENT_STATUSES] },
    },
    select: { id: true },
  })) as Array<{ id: string }>;
  if (arrived.length === 0) return 0;

  const arrivedIds = new Set(arrived.map((a) => a.id));
  const moot = live.filter((a) => {
    const id = apptIdOf(a.payload);
    return id !== null && arrivedIds.has(id);
  });
  return retireActions(prisma, clinicId, moot, "patient_in_clinic");
}
