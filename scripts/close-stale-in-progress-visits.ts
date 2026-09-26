/**
 * Audit Q-13 data fix: IN_PROGRESS visits left over from earlier clinic days.
 *
 * A doctor who forgot «Завершить приём» left the visit IN_PROGRESS for good,
 * and the next morning «Вызвать» answered «уже идёт приём: <вчерашний
 * пациент>». After the deploy the start guard ignores such rows (bounded to
 * the Tashkent day) and the appointment lifecycle sweep closes them every
 * 10 minutes, so this script is NOT required: it shows what the first sweep
 * tick will close (dry run), and can apply the same close-out ahead of it.
 *
 * What a close-out does, identical to the sweep (`closeStaleInProgressVisits`
 * in src/server/workers/appointment-lifecycle-sweep.ts; the two rules come
 * from src/server/appointments/stale-visit.ts):
 *   - status + queueStatus → COMPLETED, conditional on still IN_PROGRESS;
 *   - completedAt = start (startedAt, else the slot) + the booked duration,
 *     so the visit stays on its own day in reports;
 *   - the conclusion is NOT touched: a DRAFT stays a draft (never signed,
 *     never deleted) and waits in «Заключения → Черновики»;
 *   - an AuditLog row `appointment.auto-close-stale-visit` naming the
 *     unsigned note, and the patient's visit stats refreshed;
 *   - no patient messages.
 * Unlike the sweep it publishes no realtime event; open screens pick the
 * change up on their next refetch.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/close-stale-in-progress-visits.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/close-stale-in-progress-visits.ts
 *
 * Idempotent: a closed visit is no longer IN_PROGRESS, so a second run finds
 * nothing to do.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { tashkentDayBounds } from "../src/lib/booking-validation";
import {
  staleInProgressWhere,
  staleVisitCompletedAt,
} from "../src/server/appointments/stale-visit";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

async function refreshVisitStats(patientId: string): Promise<void> {
  // Same recompute as refreshPatientVisitStats (src/server/patient/last-contacted.ts).
  const [visitsCount, latest] = await Promise.all([
    prisma.appointment.count({ where: { patientId, status: "COMPLETED" } }),
    prisma.appointment.findFirst({
      where: { patientId, status: "COMPLETED" },
      orderBy: [{ completedAt: "desc" }, { date: "desc" }],
      select: { completedAt: true, date: true },
    }),
  ]);
  await prisma.patient.updateMany({
    where: { id: patientId },
    data: {
      visitsCount,
      lastVisitAt: latest ? (latest.completedAt ?? latest.date) : null,
    },
  });
}

async function main() {
  const now = new Date();
  const { dayStart } = tashkentDayBounds(now);

  const stale = await prisma.appointment.findMany({
    where: staleInProgressWhere(dayStart),
    orderBy: { date: "asc" },
    select: {
      id: true,
      clinicId: true,
      doctorId: true,
      patientId: true,
      date: true,
      startedAt: true,
      durationMin: true,
      doctor: { select: { nameRu: true } },
      visitNote: { select: { id: true, status: true } },
    },
  });

  console.log(
    `[q13] stale IN_PROGRESS visits before ${dayStart.toISOString()}: ${stale.length}${APPLY ? "" : " (dry run)"}`,
  );

  let closed = 0;
  for (const row of stale) {
    const completedAt = staleVisitCompletedAt(row);
    const draftId =
      row.visitNote?.status === "DRAFT" ? row.visitNote.id : null;
    console.log(
      `  ${row.id} doctor=${row.doctor?.nameRu ?? row.doctorId} slot=${row.date.toISOString()} started=${row.startedAt?.toISOString() ?? "-"} -> completedAt=${completedAt.toISOString()} unsignedDraft=${draftId ?? "-"}`,
    );
    if (!APPLY) continue;

    const res = await prisma.appointment.updateMany({
      where: { id: row.id, status: "IN_PROGRESS" },
      data: { status: "COMPLETED", queueStatus: "COMPLETED", completedAt },
    });
    if (res.count === 0) continue;
    await prisma.auditLog.create({
      data: {
        clinicId: row.clinicId,
        action: "appointment.auto-close-stale-visit",
        entityType: "Appointment",
        entityId: row.id,
        meta: {
          from: "IN_PROGRESS",
          to: "COMPLETED",
          startedAt: row.startedAt?.toISOString() ?? null,
          completedAt: completedAt.toISOString(),
          unsignedVisitNoteId: draftId,
          via: "scripts/close-stale-in-progress-visits.ts",
        },
        actorId: null,
        actorRole: null,
        actorLabel: "system",
      },
    });
    await refreshVisitStats(row.patientId);
    closed += 1;
  }

  if (APPLY) console.log(`[q13] closed ${closed}/${stale.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
