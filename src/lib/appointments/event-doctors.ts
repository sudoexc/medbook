/**
 * Which doctors an `appointment.*` / `queue.updated` event concerns.
 *
 * Audit G3-12: moving a visit to another doctor (calendar drag, the card, a
 * Mini App reschedule) published only the NEW doctor's id, and every
 * doctor-side screen drops events that name someone else. The previous
 * doctor's «Мой день», agenda and door board kept showing the patient until
 * the next poll. Publishers now add `previousDoctorId` when the doctor
 * changed, and the doctor-side filters accept either id.
 *
 * Pure and dependency-free: the server publishers and the client filters
 * both import it.
 */

/** `{ previousDoctorId }` when the visit changed doctor, else nothing. */
export function previousDoctorField(
  beforeDoctorId: string | null | undefined,
  afterDoctorId: string | null | undefined,
): { previousDoctorId?: string } {
  return beforeDoctorId && beforeDoctorId !== afterDoctorId
    ? { previousDoctorId: beforeDoctorId }
    : {};
}

/**
 * The doctor ids a payload names: `doctorId` and, after a transfer,
 * `previousDoctorId`. Empty when it names none (legacy or unscoped
 * publisher), which callers treat as «cannot rule it out».
 */
export function eventDoctorIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as { doctorId?: unknown; previousDoctorId?: unknown };
  const ids: string[] = [];
  for (const v of [p.doctorId, p.previousDoctorId]) {
    if (typeof v === "string" && v.length > 0 && !ids.includes(v)) ids.push(v);
  }
  return ids;
}
