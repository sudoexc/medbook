/**
 * Detector: IDLE_ROOM.
 *
 * For each cabinet, check whether:
 *   - it has no IN_PROGRESS appointment right now
 *   - the most recent appointment in this cabinet ended at least
 *     `idleRoomMinutes` ago (today)
 *   - there is at least one WAITING patient in the clinic queue today
 *
 * If all three hold, emit one action per idle cabinet. Severity `medium`,
 * `expiresAt = now + 30 minutes` since the queue and cabinet state are
 * volatile.
 */
import type { IdleRoomPayload } from "@/lib/actions/types";

import type { DetectorConfig } from "../config";
import type { PrismaLike } from "./_shared";
import { startOfUtcDay, addDays } from "./_shared";

type CabinetRow = {
  id: string;
  number: string;
  nameRu: string | null;
  isActive: boolean;
};
type ApptRow = {
  cabinetId: string | null;
  status: string;
  date: Date;
  endDate: Date;
};

export async function detectIdleRoom(
  prisma: PrismaLike,
  _clinicId: string,
  now: Date,
  config: DetectorConfig,
): Promise<IdleRoomPayload[]> {
  const todayStart = startOfUtcDay(now);
  const todayEnd = addDays(todayStart, 1);

  const cabinets = (await prisma.cabinet.findMany({
    where: { isActive: true },
    select: { id: true, number: true, nameRu: true, isActive: true },
  })) as CabinetRow[];
  if (cabinets.length === 0) return [];

  const appts = (await prisma.appointment.findMany({
    where: {
      cabinetId: { in: cabinets.map((c) => c.id) },
      date: { gte: todayStart, lt: todayEnd },
    },
    select: {
      cabinetId: true,
      status: true,
      date: true,
      endDate: true,
    },
  })) as ApptRow[];

  // Clinic-wide queue length today (anyone WAITING).
  const queueLength = appts.filter((a) => a.status === "WAITING").length;
  if (queueLength === 0) return []; // no point flagging idle rooms without a queue

  const idleThresholdMs = config.idleRoomMinutes * 60 * 1000;
  const out: IdleRoomPayload[] = [];

  for (const cab of cabinets) {
    const cabAppts = appts.filter((a) => a.cabinetId === cab.id);
    const inProgress = cabAppts.some((a) => a.status === "IN_PROGRESS");
    if (inProgress) continue;

    // Most recent ended appointment in this cabinet today.
    const ended = cabAppts
      .filter((a) => a.status === "COMPLETED" || a.status === "SKIPPED")
      .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
    const lastEnd = ended[0]?.endDate;
    if (!lastEnd) continue; // never used today
    const idleMs = now.getTime() - lastEnd.getTime();
    if (idleMs < idleThresholdMs) continue;
    const idleMinutes = Math.floor(idleMs / 60000);

    out.push({
      type: "IDLE_ROOM",
      cabinetId: cab.id,
      cabinetName: cab.nameRu ?? cab.number,
      idleMinutes,
      queueLength,
    });
  }
  out.sort((a, b) => (a.cabinetId < b.cabinetId ? -1 : 1));
  return out;
}
