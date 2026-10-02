/**
 * Inbox triage by «temperature» (client-side, over the loaded rows).
 */
import type { InboxConversation } from "../_hooks/types";

export type Temperature = "hot" | "warm" | "cold";

export const HOT_MAX_MIN = 120; // waiting for a reply + last activity within 2h → needs reply now
export const WARM_MAX_MIN = 24 * 60; // activity within a day → still warm

/**
 * Lead-urgency heuristic from «waiting for a reply» + recency (client-side
 * triage). Waiting, not unread: an open chat is read at once (G6-05) while
 * the question in it is still unanswered (G6-03).
 */
export function temperatureOf(row: InboxConversation, now: number): Temperature {
  const last = row.lastMessageAt ? new Date(row.lastMessageAt).getTime() : 0;
  const ageMin = last ? (now - last) / 60_000 : Number.POSITIVE_INFINITY;
  const waiting = Boolean(row.awaitingReplySince);
  if (waiting && ageMin <= HOT_MAX_MIN) return "hot";
  if (waiting || ageMin <= WARM_MAX_MIN) return "warm";
  return "cold";
}

/**
 * Which temperature counts may grow with the pages not loaded yet (audit
 * G6-22): those get a «+», so «Холодные 12» does not read as a total. The
 * list is newest first, so once the oldest loaded thread is past the hot
 * window no hot thread is left further down. A warm or cold one can be
 * anywhere (a question left unanswered for days is still warm).
 */
export function partialTemperatures(input: {
  rows: InboxConversation[];
  hasNextPage: boolean;
  now: number;
}): Record<Temperature, boolean> {
  if (!input.hasNextPage) return { hot: false, warm: false, cold: false };
  const oldest = input.rows[input.rows.length - 1];
  const oldestAt = oldest?.lastMessageAt
    ? new Date(oldest.lastMessageAt).getTime()
    : null;
  const hotDone =
    oldest !== undefined &&
    (oldestAt === null || (input.now - oldestAt) / 60_000 > HOT_MAX_MIN);
  return { hot: !hotDone, warm: true, cold: true };
}
