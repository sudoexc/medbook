/**
 * Which conversations belong to a doctor — the ONE place that answers it.
 *
 * The rule lived twice: in the conversations list and, «mirroring» it, in the
 * doctor's sidebar unread counter. The mirror drifted within an hour of the
 * first edit — the list was widened to cover the doctor's patients and
 * unlinked threads, the counter kept the old appointment-only scope, and the
 * doctor received messages with no badge («не было уведы»). A copy that
 * promises to mirror something is where the next bug lives; both callers now
 * import this.
 *
 * The scope, deliberately wide for a working clinic:
 *  - threads tied to one of the doctor's appointments;
 *  - threads of patients he has ever seen (his caseload is patients, not
 *    appointment rows — TG threads usually predate the appointment link);
 *  - unlinked threads (`patientId: null`) — the clinic's front door; they
 *    carry no other doctor's clinical data;
 *  - threads explicitly assigned to his user.
 */
export function doctorConversationScope(
  doctorId: string,
  userId: string | null,
): Array<Record<string, unknown>> {
  const or: Array<Record<string, unknown>> = [
    { appointment: { doctorId } },
    { patient: { appointments: { some: { doctorId } } } },
    { patientId: null },
  ];
  if (userId) or.push({ assignedToId: userId });
  return or;
}
