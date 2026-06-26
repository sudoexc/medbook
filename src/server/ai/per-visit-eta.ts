/**
 * Per-doctor "minutes per visit" for the live queue surfaces (TV board, kiosk
 * doctor list). Routes every estimate through the shared {@link predictETA}
 * model so the board, kiosk and patient ticket all agree instead of each
 * inventing its own formula (flat 30 min, average of queued durations, …).
 *
 * One batched query loads recent COMPLETED visits across all requested doctors;
 * samples are bucketed per doctor (capped) and fed to `predictETA`. Doctors with
 * too little history fall back to `fallbackMin`.
 */
import { prisma } from "@/lib/prisma";
import { predictETA, type EtaOutput } from "@/lib/ai/eta-predictor";

const HISTORY_PER_DOCTOR = 30;
const DEFAULT_FALLBACK_MIN = 30;

/**
 * Returns the full {@link EtaOutput} per doctor (not just the minute count) so
 * callers can surface confidence/source consistently — the patient ticket shows
 * the same "high/med/low" band the board derived from the same model.
 *
 * `fallback` may be a single number for every doctor, or a per-doctor map (the
 * queue projection passes each doctor's next-waiting booked duration, which is a
 * sharper guess than a flat 30 when history is thin).
 */
export async function predictPerVisitMinutes(
  doctorIds: string[],
  fallback: number | Map<string, number> = DEFAULT_FALLBACK_MIN,
): Promise<Map<string, EtaOutput>> {
  const result = new Map<string, EtaOutput>();
  if (doctorIds.length === 0) return result;

  const completed = await prisma.appointment.findMany({
    where: {
      doctorId: { in: doctorIds },
      status: "COMPLETED",
      startedAt: { not: null },
      completedAt: { not: null },
    },
    select: { doctorId: true, startedAt: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: doctorIds.length * HISTORY_PER_DOCTOR,
  });

  const byDoctor = new Map<string, { startedAt: Date; completedAt: Date }[]>();
  for (const c of completed) {
    if (!c.startedAt || !c.completedAt) continue;
    const bucket = byDoctor.get(c.doctorId);
    if (bucket) {
      if (bucket.length < HISTORY_PER_DOCTOR) {
        bucket.push({ startedAt: c.startedAt, completedAt: c.completedAt });
      }
    } else {
      byDoctor.set(c.doctorId, [
        { startedAt: c.startedAt, completedAt: c.completedAt },
      ]);
    }
  }

  for (const id of doctorIds) {
    const history = byDoctor.get(id) ?? [];
    const fallbackMin =
      typeof fallback === "number"
        ? fallback
        : (fallback.get(id) ?? DEFAULT_FALLBACK_MIN);
    result.set(id, predictETA({ history, fallbackMin }));
  }
  return result;
}
