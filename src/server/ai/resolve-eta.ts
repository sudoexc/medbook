/**
 * Phase 10 — server resolver for ETA prediction.
 *
 * Loads the appointment + its primary service (for fallback duration), then
 * fetches up to 30 of the most recent COMPLETED appointments for the same
 * (doctorId, serviceId) pair (auto-scoped to the active TenantContext via
 * the Prisma extension), feeds the durations into `predictETA`, and returns
 * the result alongside a small bag of appointment basics for the UI.
 */

import { prisma } from "@/lib/prisma";
import { predictETA, type EtaOutput } from "@/lib/ai/eta-predictor";

export interface ResolveEtaResult {
  appointmentId: string;
  doctorId: string;
  serviceId: string | null;
  fallbackMin: number;
  prediction: EtaOutput;
}

export async function resolveEta(
  appointmentId: string,
): Promise<ResolveEtaResult | null> {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId },
    include: {
      primaryService: { select: { id: true, durationMin: true } },
    },
  });
  if (!appt) return null;

  const fallbackMin = appt.primaryService?.durationMin ?? appt.durationMin ?? 30;
  const serviceId = appt.serviceId ?? null;

  // Without a service we can't pin history — fall back deterministically.
  if (!serviceId) {
    const prediction = predictETA({ history: [], fallbackMin });
    return {
      appointmentId: appt.id,
      doctorId: appt.doctorId,
      serviceId: null,
      fallbackMin,
      prediction,
    };
  }

  const completed = await prisma.appointment.findMany({
    where: {
      doctorId: appt.doctorId,
      serviceId,
      status: "COMPLETED" as never,
      startedAt: { not: null },
      completedAt: { not: null },
    },
    select: { startedAt: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: 30,
  });

  const history = completed
    .filter(
      (c): c is { startedAt: Date; completedAt: Date } =>
        c.startedAt !== null && c.completedAt !== null,
    )
    .map((c) => ({ startedAt: c.startedAt, completedAt: c.completedAt }));

  const prediction = predictETA({ history, fallbackMin });
  return {
    appointmentId: appt.id,
    doctorId: appt.doctorId,
    serviceId,
    fallbackMin,
    prediction,
  };
}
