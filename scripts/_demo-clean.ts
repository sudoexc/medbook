/**
 * Delete demo patients with everything hanging off them, child rows first, in
 * the caller's transaction (audit G2-07).
 *
 * seed-demo-data's CLEAN used to delete appointments and payments one by one
 * and then `patient.deleteMany`, which failed on the RESTRICT links that
 * seed-clinical-life adds (visit notes, e-prescriptions, lab orders, cases):
 * the run stopped halfway with the visits gone and the patients still there.
 * Run inside `$transaction`, this removes every demo row or nothing.
 *
 * The order is data, so a unit test can check it against prisma/schema.prisma:
 * every model that points at Patient, Appointment or VisitNote without
 * `onDelete: Cascade` comes before the model it points at.
 */

/** Prisma delegate names, deleted in this order. */
export const DEMO_PATIENT_DELETE_ORDER = [
  "cdsOverride",
  "labResult",
  "labOrder",
  "ePrescription",
  "sickLeave",
  "referral",
  "reminder",
  "notificationSend",
  "document",
  "payment",
  "communication",
  "call",
  "review",
  "patientReview",
  "conversation",
  "visitNote",
  "appointment",
  "medicalCase",
  "patient",
] as const;

export type DemoDeleteModel = (typeof DEMO_PATIENT_DELETE_ORDER)[number];

/** Models that also hang off an appointment (possibly with no patientId of their own). */
const BY_APPOINTMENT = new Set<DemoDeleteModel>([
  "cdsOverride",
  "labResult",
  "labOrder",
  "ePrescription",
  "sickLeave",
  "reminder",
  "notificationSend",
  "document",
  "payment",
  "patientReview",
  "conversation",
]);

/** The where clause for one step. */
export function demoDeleteWhere(
  model: DemoDeleteModel,
  patientIds: string[],
  appointmentIds: string[],
): Record<string, unknown> {
  if (model === "patient") return { id: { in: patientIds } };
  if (model === "appointment") return { id: { in: appointmentIds } };
  const byPatient = { patientId: { in: patientIds } };
  if (BY_APPOINTMENT.has(model) && appointmentIds.length > 0) {
    return { OR: [byPatient, { appointmentId: { in: appointmentIds } }] };
  }
  return byPatient;
}

type Delegate = { deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }> };
type Tx = Record<DemoDeleteModel, Delegate> & {
  appointment: Delegate & {
    findMany(args: {
      where: { patientId: { in: string[] } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
};

/** Returns rows deleted per model. Call it inside `prisma.$transaction`. */
export async function deleteDemoPatients(
  tx: Tx,
  patientIds: string[],
): Promise<Partial<Record<DemoDeleteModel, number>>> {
  const out: Partial<Record<DemoDeleteModel, number>> = {};
  if (patientIds.length === 0) return out;
  const appointmentIds = (
    await tx.appointment.findMany({
      where: { patientId: { in: patientIds } },
      select: { id: true },
    })
  ).map((a) => a.id);
  for (const model of DEMO_PATIENT_DELETE_ORDER) {
    const res = await tx[model].deleteMany({
      where: demoDeleteWhere(model, patientIds, appointmentIds),
    });
    out[model] = res.count;
  }
  return out;
}
