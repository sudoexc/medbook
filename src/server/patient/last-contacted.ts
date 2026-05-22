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
