/**
 * Server side of «Перерыв» / «Обед» (src/lib/doctor-pause.ts).
 */
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { parseDoctorPauseKind, type DoctorPauseView } from "@/lib/doctor-pause";
import { publishEventSafe } from "@/server/realtime/publish";

/**
 * The doctor's open pause: no end, started today. One left open overnight
 * (he forgot to press «Закончить» before going home) ends by itself.
 */
export async function currentDoctorPause(
  doctorId: string,
  now: Date = new Date(),
): Promise<DoctorPauseView | null> {
  const { dayStart } = tashkentDayBounds(now);
  const row = await prisma.doctorPause.findFirst({
    where: { doctorId, endedAt: null, startedAt: { gte: dayStart } },
    orderBy: { startedAt: "desc" },
    select: { id: true, kind: true, startedAt: true },
  });
  const kind = row ? parseDoctorPauseKind(row.kind) : null;
  return row && kind ? { id: row.id, kind, startedAt: row.startedAt.toISOString() } : null;
}

/**
 * The doctor's TV refetches on this poke (the public board stream carries
 * `queue.updated` with the doctor only), and so do the reception screens.
 */
export function publishDoctorPauseChanged(clinicId: string, doctorId: string): void {
  publishEventSafe(clinicId, { type: "queue.updated", payload: { doctorId } });
}
