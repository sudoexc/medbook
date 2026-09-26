/**
 * Denormalised "last operator-driven contact" timestamp.
 *
 * `Patient.lastContactedAt` is the most-recent timestamp across:
 *   - manual SMS / email (`Communication`)
 *   - telegram conversation message (`Message`, either direction)
 *   - voice call (`Call`, any direction)
 *   - completed visit (`Appointment.status = COMPLETED`)
 *
 * Automated template sends (`NotificationSend`) are deliberately *excluded* —
 * those are mechanical reminders, not a "we got in touch" signal.
 *
 * Call this from every write-site that creates one of those rows. The helper
 * is monotonic — it only advances `lastContactedAt` forward, so out-of-order
 * writes (e.g. a backfilled historical call inserted after a fresher message)
 * can't regress the field. The write also fans out to the `lastContacted`
 * realtime channel so any patient surface listening for SSE updates can
 * reflect the change without a full page reload.
 *
 * Usage:
 *   await bumpPatientLastContact(patientId);              // now
 *   await bumpPatientLastContact(patientId, callAt);      // explicit ts
 *
 * Tenancy: this uses the tenant-scoped `prisma` extension. The caller must
 * already be inside a TENANT or SYSTEM context (webhook handlers wrap in
 * `runWithTenant({ kind: "SYSTEM" })`).
 */
import { prisma } from "@/lib/prisma";

export async function bumpPatientLastContact(
  patientId: string,
  at: Date = new Date(),
): Promise<void> {
  // `updateMany` lets us add a WHERE clause that guarantees monotonicity in
  // a single round-trip. The matcher fires when the column is NULL OR the
  // existing timestamp is older — never overwriting a fresher value.
  try {
    await prisma.patient.updateMany({
      where: {
        id: patientId,
        OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: at } }],
      },
      data: { lastContactedAt: at },
    });
  } catch (err) {
    // Never let a contact-stamp failure abort the write that triggered it —
    // the row that *caused* this bump is far more important than the cached
    // timestamp. Log and swallow.
    console.error("[bumpPatientLastContact] failed", {
      patientId,
      at,
      err,
    });
  }
}

/**
 * Denormalised visit statistics: `Patient.lastVisitAt` + `Patient.visitsCount`.
 *
 * Both columns existed from the start and several features read them — the
 * dormant-patient detector (`server/actions/detectors/dormant-batch.ts`), the
 * NEW/ACTIVE segment logic, `derivePatientTags` on the doctor's screens,
 * campaign audiences — but nothing ever WROTE them outside seeds. So the
 * "спящие пациенты" механика never fired in production and every patient
 * looked like a first-timer forever.
 *
 * Called from the visit-completion paths. `visitsCount` is RECOUNTED rather
 * than incremented: a completed visit can be reverted (doctor un-does a
 * mis-click) and an increment would drift permanently; a recount is always
 * the truth for a handful of rows. `lastVisitAt` is recomputed from the
 * latest COMPLETED appointment for the same reason.
 */
export async function refreshPatientVisitStats(
  patientId: string,
): Promise<void> {
  try {
    // `completedAt` — when the visit actually ended — not `date`, which is
    // the booked slot: a next-week slot seen today would otherwise push
    // `lastVisitAt` into the FUTURE and outrank a visit genuinely completed
    // yesterday. Rows completed before that column was populated fall back
    // to the slot time.
    //
    // That is MAX(COALESCE(completedAt, date)), read as two queries (audit
    // PT-06). One `orderBy completedAt desc` let Postgres sort NULLs FIRST,
    // so a single legacy row without `completedAt` beat every real visit
    // and «Последний визит» froze on its March slot for good.
    const completed = { patientId, status: "COMPLETED" } as const;
    const [visitsCount, latestStamped, latestLegacy] = await Promise.all([
      prisma.appointment.count({ where: completed }),
      prisma.appointment.findFirst({
        where: { ...completed, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        select: { completedAt: true },
      }),
      prisma.appointment.findFirst({
        where: { ...completed, completedAt: null },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
    ]);
    await prisma.patient.updateMany({
      where: { id: patientId },
      data: {
        visitsCount,
        lastVisitAt: latestVisitAt(
          latestStamped?.completedAt ?? null,
          latestLegacy?.date ?? null,
        ),
      },
    });
  } catch (e) {
    // Never fail a visit over a denormalised counter.
    console.warn(
      `[patient-stats] refresh failed for ${patientId}: ${(e as Error).message}`,
    );
  }
}

/**
 * The later of the newest stamped completion and the newest legacy slot
 * (a completed row with no `completedAt`). Null when there is neither.
 */
export function latestVisitAt(
  latestCompletedAt: Date | null,
  latestLegacySlot: Date | null,
): Date | null {
  if (!latestCompletedAt) return latestLegacySlot;
  if (!latestLegacySlot) return latestCompletedAt;
  return latestLegacySlot > latestCompletedAt
    ? latestLegacySlot
    : latestCompletedAt;
}
