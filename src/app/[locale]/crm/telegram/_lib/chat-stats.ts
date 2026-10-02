/**
 * The Telegram rail's statistics card (audit G6-17). Pure, so the rules are
 * tested without the page.
 *
 * It counts the messages the chat has loaded, and its header says so: the
 * old «за 30 дней» had no 30-day bound behind it, and the numbers moved as
 * older pages loaded. Who wrote an OUT message decides its tile: a staff
 * member's has a `senderId`; the bot's own replies (the welcome, the
 * buttons) have neither a sender nor an `origin`; broadcasts and reminders
 * copied into the dialog (G6-08) carry an `origin` and answer nobody, so
 * they count as neither.
 */
type StatMessage = {
  direction: "IN" | "OUT";
  senderId: string | null;
  origin?: "broadcast" | "notification" | null;
  createdAt: string;
};

export type ChatMessageCounts = {
  fromPatient: number;
  staffReplies: number;
  botReplies: number;
};

export function chatMessageCounts(
  messages: readonly StatMessage[],
): ChatMessageCounts {
  const counts: ChatMessageCounts = { fromPatient: 0, staffReplies: 0, botReplies: 0 };
  for (const m of messages) {
    if (m.direction === "IN") counts.fromPatient += 1;
    else if (m.senderId) counts.staffReplies += 1;
    else if (!m.origin) counts.botReplies += 1;
  }
  return counts;
}

/**
 * Mean seconds from a patient's first unanswered message to the staff
 * reply that answered it. The bot's instant welcome and the automatic
 * sends are not an answer: counting them made the average «3s». Null until
 * at least one patient message got a staff reply.
 */
export function avgStaffReplySeconds(messages: readonly StatMessage[]): number | null {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let waitingSince: number | null = null;
  const gaps: number[] = [];
  for (const m of sorted) {
    const at = new Date(m.createdAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (m.direction === "IN") {
      waitingSince ??= at;
    } else if (m.senderId && waitingSince !== null) {
      gaps.push((at - waitingSince) / 1000);
      waitingSince = null;
    }
  }
  if (gaps.length === 0) return null;
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
}

/** A duration as a number and its unit, for a translated «{n} мин». */
export function durationParts(seconds: number): {
  unit: "sec" | "min" | "hour";
  n: number;
} {
  // Rounded before the unit is picked, so 59.6 s reads «1 мин», not «60 с».
  const secs = Math.round(seconds);
  if (secs < 60) return { unit: "sec", n: secs };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { unit: "min", n: minutes };
  return { unit: "hour", n: Math.round((seconds / 3600) * 10) / 10 };
}
