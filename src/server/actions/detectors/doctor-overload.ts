/**
 * Detector: DOCTOR_OVERLOAD.
 *
 * Inspects today's queue (appointments with status WAITING or IN_PROGRESS)
 * grouped by doctor. Doctors whose queue length meets or exceeds
 * `doctorOverloadQueueLength` get an action. The payload lists same-specialty
 * doctors whose queue is at most half the threshold so the receptionist can
 * propose a reassignment.
 *
 * Severity: `high`. `expiresAt = now + 30 minutes` since the queue picture
 * is highly volatile and a stale "overload" warning is worse than no warning.
 */
import type { DoctorOverloadPayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { startOfUtcDay, addDays } from "./_shared";

type DoctorRow = {
  id: string;
  nameRu: string;
  specializationRu: string;
  isActive: boolean;
};
type ApptRow = {
  doctorId: string;
  status: string;
};

export async function detectDoctorOverload(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<DoctorOverloadPayload[]> {
  const todayStart = startOfUtcDay(now);
  const todayEnd = addDays(todayStart, 1);

  const doctors = (await prisma.doctor.findMany({
    where: { isActive: true },
    select: {
      id: true,
      nameRu: true,
      specializationRu: true,
      isActive: true,
    },
  })) as DoctorRow[];
  if (doctors.length === 0) return [];

  const appts = (await prisma.appointment.findMany({
    where: {
      doctorId: { in: doctors.map((d) => d.id) },
      date: { gte: todayStart, lt: todayEnd },
      status: { in: ["WAITING", "IN_PROGRESS"] },
    },
    select: { doctorId: true, status: true },
  })) as ApptRow[];

  const queueByDoctor = new Map<string, number>();
  for (const a of appts) {
    queueByDoctor.set(a.doctorId, (queueByDoctor.get(a.doctorId) ?? 0) + 1);
  }

  const threshold = config.doctorOverloadQueueLength;
  const altThreshold = Math.floor(threshold / 2);

  // Index doctors by specialty for quick alternative lookup.
  const bySpec = new Map<string, DoctorRow[]>();
  for (const d of doctors) {
    const arr = bySpec.get(d.specializationRu) ?? [];
    arr.push(d);
    bySpec.set(d.specializationRu, arr);
  }

  const out: DoctorOverloadPayload[] = [];
  for (const d of doctors) {
    const queueLength = queueByDoctor.get(d.id) ?? 0;
    if (queueLength < threshold) continue;
    const peers = bySpec.get(d.specializationRu) ?? [];
    const alternatives: string[] = [];
    for (const p of peers) {
      if (p.id === d.id) continue;
      const q = queueByDoctor.get(p.id) ?? 0;
      if (q <= altThreshold) alternatives.push(p.id);
    }
    out.push({
      type: "DOCTOR_OVERLOAD",
      doctorId: d.id,
      doctorName: d.nameRu,
      queueLength,
      alternativeDoctorIds: alternatives,
    });
  }
  // Stable order to keep dedupeKey-derived audit churn at bay across runs.
  out.sort((a, b) => (a.doctorId < b.doctorId ? -1 : 1));
  return out;
}
