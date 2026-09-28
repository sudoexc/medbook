/**
 * Public identities of an appointment (audit INF-10).
 *
 * The raw appointment id used to be the capability: `/q/<id>` and
 * `/api/queue/status/<id>` answered anyone holding it, while the anonymous
 * board stream (`/api/c/<slug>/queue/events`) and board snapshot handed every
 * id of the clinic to whoever opened them. Put together, a stranger could log
 * who visited the neurologist, when, with which doctor and for what service.
 *
 * Now the id never leaves on a public surface, and two derived values stand
 * in for it:
 *
 *   - `queueTicketToken(id)`: `<id>.<hmac>`, printed as the QR on the paper
 *     ticket and served to the patient's own Mini App. Only the server can
 *     mint it, so knowing an id (or a board row key) opens nothing. The
 *     status endpoint additionally answers only on the appointment's own
 *     clinic day, so a ticket found in the bin tomorrow is dead.
 *   - `boardRowKey(id)`: an opaque per-row key for the waiting-room screens.
 *     The TVs need to match a `queue.called` signal to a row of their
 *     snapshot (audit Q-10); an HMAC under a different purpose gives them a
 *     stable join key that is neither the id nor a ticket token.
 */
import { appHmac, appHmacMatches } from "@/server/crypto/app-hmac";
import { tashkentDateOf } from "@/lib/tashkent-time";

const TICKET_PURPOSE = "queue-ticket-v1";
const ROW_PURPOSE = "board-row-v1";

/** Our ids are cuids; anything else in the id half is not ours. */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function queueTicketToken(appointmentId: string): string {
  return `${appointmentId}.${appHmac(TICKET_PURPOSE, appointmentId)}`;
}

export type ParsedQueueTicket =
  | { kind: "token"; appointmentId: string }
  /**
   * A bare appointment id: the QR printed before this change. It is never
   * looked up (the id is no longer a capability), but the page can tell the
   * patient the link is outdated instead of «not found».
   */
  | { kind: "legacy" }
  | { kind: "invalid" };

export function parseQueueTicketToken(raw: string): ParsedQueueTicket {
  const value = (raw ?? "").trim();
  const dot = value.indexOf(".");
  if (dot === -1) {
    return ID_RE.test(value) ? { kind: "legacy" } : { kind: "invalid" };
  }
  const appointmentId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!ID_RE.test(appointmentId) || !signature) return { kind: "invalid" };
  return appHmacMatches(TICKET_PURPOSE, appointmentId, signature)
    ? { kind: "token", appointmentId }
    : { kind: "invalid" };
}

/**
 * Where the appointment's clinic day sits relative to today (Tashkent wall
 * clock): the ticket link works on that day only.
 */
export function ticketDayState(
  appointmentDate: Date,
  now: Date = new Date(),
): "today" | "past" | "future" {
  const day = tashkentDateOf(appointmentDate);
  const today = tashkentDateOf(now);
  if (day === today) return "today";
  return day < today ? "past" : "future";
}

/** Opaque, stable join key for one appointment row on the public screens. */
export function boardRowKey(appointmentId: string): string {
  return appHmac(ROW_PURPOSE, appointmentId, 12);
}
