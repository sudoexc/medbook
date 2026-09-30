/**
 * Whether the doctor's cabinet should ring for a Telegram message (audit
 * DC-04).
 *
 * The realtime bus hands every `tg.message.new` of the clinic to every
 * screen of it, and the shell-level alert played the ping and showed the
 * preview of each one: «Мадина: опять приступ…», another doctor's patient,
 * in the middle of a visit. The doctor's inbox shows only his threads
 * (`doctorConversationScope`), so the alert asks the server the same
 * question before it rings.
 *
 * Silent whenever it cannot tell (no thread id, a network error): a missed
 * ping costs little, the unread badge on «Сообщения» still counts the
 * message; a ping about someone else's patient is the leak being fixed.
 *
 * Client-safe: no server imports.
 */
export async function isDoctorThread(
  conversationId: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!conversationId) return false;
  try {
    const res = await fetchImpl(
      `/api/crm/doctors/me/conversations/${encodeURIComponent(conversationId)}/scope`,
      { credentials: "include" },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { inScope?: unknown };
    return body.inScope === true;
  } catch {
    return false;
  }
}
