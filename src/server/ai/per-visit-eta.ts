/**
 * Per-doctor "minutes per visit" for the live queue surfaces (TV board, kiosk
 * doctor list). Routes every estimate through the shared {@link predictETA}
 * model so the board, kiosk and patient ticket all agree instead of each
 * inventing its own formula (flat 30 min, average of queued durations, …).
 *
 * Each doctor's own last COMPLETED visits (up to `HISTORY_PER_DOCTOR`, within
 * `HISTORY_WINDOW_DAYS`) feed `predictETA`. Doctors with too little history
 * fall back to `fallbackMin`.
 *
 * One query per doctor, not one shared `take: doctors × 30` (audit AC-26):
 * ordered by completion across the whole clinic, the shared budget went to
 * whoever finished most visits lately. A doctor seeing 25 patients a day
 * filled all 150 rows, a neurologist with 6 a day got none, and the board
 * and the patient's ticket showed him the fallback «~30 мин» instead of his
 * real 50. The queue has a handful of doctors, and each query is a short
 * range on the (clinicId, doctorId, date) index.
 */
import { prisma } from "@/lib/prisma";
import { predictETA, type EtaOutput } from "@/lib/ai/eta-predictor";

const HISTORY_PER_DOCTOR = 30;
/** How far back a visit still says how long this doctor's visits take. */
const HISTORY_WINDOW_DAYS = 90;
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

  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const uniqueIds = [...new Set(doctorIds)];
  const histories = await Promise.all(
    uniqueIds.map((doctorId) =>
      prisma.appointment.findMany({
        where: {
          doctorId,
          status: "COMPLETED",
          date: { gte: since },
          startedAt: { not: null },
          completedAt: { not: null },
        },
        select: { startedAt: true, completedAt: true },
        orderBy: { completedAt: "desc" },
        take: HISTORY_PER_DOCTOR,
      }),
    ),
  );

  const byDoctor = new Map<string, { startedAt: Date; completedAt: Date }[]>();
  uniqueIds.forEach((doctorId, i) => {
    const samples: { startedAt: Date; completedAt: Date }[] = [];
    for (const c of histories[i] ?? []) {
      if (c.startedAt && c.completedAt) {
        samples.push({ startedAt: c.startedAt, completedAt: c.completedAt });
      }
    }
    byDoctor.set(doctorId, samples);
  });

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
