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
 * The scope:
 *  - threads tied to one of the doctor's appointments;
 *  - threads of patients he has ever seen (his caseload is patients, not
 *    appointment rows — TG threads usually predate the appointment link);
 *  - threads explicitly assigned to his user.
 *
 * Unlinked threads (`patientId: null`) are NOT his any more (audit DC-10).
 * They are the clinic's front door, a stranger nobody has identified yet,
 * and reception answers them. Counting them put «+1» on every doctor's
 * «Сообщения» for each new contact, and a doctor opening one cleared the
 * desk's unread mark. Since audit TG-11 a known patient's thread is linked
 * on arrival, so his own patients no longer arrive unlinked; a stranger
 * reception wants a doctor to answer is assigned to him, and then it is in.
 */
export function doctorConversationScope(
  doctorId: string,
  userId: string | null,
): Array<Record<string, unknown>> {
  const or: Array<Record<string, unknown>> = [
    { appointment: { doctorId } },
    { patient: { appointments: { some: { doctorId } } } },
  ];
  if (userId) or.push({ assignedToId: userId });
  return or;
}
