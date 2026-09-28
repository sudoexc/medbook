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
 *     status endpoint and the print stub answer it only on the appointment's
 *     own clinic day, so a ticket found in the bin tomorrow is dead. The id
 *     half is readable, which is why no anonymous surface takes a bare id:
 *     the print stub `/ticket/<id>` wants a staff session for one (see
 *     `resolveTicketStubRequest`).
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

/**
 * Who asks for the printable stub at `/ticket/<ref>` (audit INF-10).
 *
 * The stub opened for any bare appointment id, anonymously, on any day, with
 * the service name on it, and minted a fresh queue token besides. The id is
 * the readable half of every QR token, so a ticket from the bin split at the
 * dot gave back «А. К., Султанов, ЭЭГ, 14:30». Two callers print it, and each
 * now brings its own key:
 *
 *   - the front desk, from the CRM walk-in dialog, with a staff session: a
 *     bare id opens an appointment of the signed-in user's own clinic, on any
 *     day (a reprint), service line included;
 *   - the lobby kiosk, which has no session (its device token travels in a
 *     header a new tab cannot send): it opens the stub with the signed ticket
 *     token from its walk-in / check-in answer, under the QR's own rule, the
 *     appointment's day only, and without the service line.
 *
 * Anything else, a bare id without a staff session included, is refused
 * before any lookup, so it cannot even tell whether the id exists.
 */
export type TicketStubRequest =
  | { kind: "lookup"; appointmentId: string; viewer: "staff"; clinicId: string }
  | { kind: "lookup"; appointmentId: string; viewer: "holder" }
  | { kind: "refuse"; reason: "staff_only" | "not_found" };

export async function resolveTicketStubRequest(
  ref: string,
  /** The signed-in staff member's clinic, or null. Asked only for a bare id. */
  staffClinicId: () => Promise<string | null>,
): Promise<TicketStubRequest> {
  const parsed = parseQueueTicketToken(ref);
  if (parsed.kind === "token") {
    return { kind: "lookup", appointmentId: parsed.appointmentId, viewer: "holder" };
  }
  if (parsed.kind === "invalid") return { kind: "refuse", reason: "not_found" };
  const clinicId = await staffClinicId();
  if (!clinicId) return { kind: "refuse", reason: "staff_only" };
  return {
    kind: "lookup",
    appointmentId: ref.trim(),
    viewer: "staff",
    clinicId,
  };
}

export type TicketStubVerdict =
  | { ok: true; showService: boolean }
  | { ok: false; reason: "not_found" | "expired" | "not_today" };

/** Whether the looked-up appointment may be shown to this viewer. */
export function ticketStubVerdict(
  request: Extract<TicketStubRequest, { kind: "lookup" }>,
  appointment: { clinicId: string; date: Date } | null,
  now: Date = new Date(),
): TicketStubVerdict {
  if (!appointment) return { ok: false, reason: "not_found" };
  if (request.viewer === "staff") {
    // Another clinic's appointment looks exactly like a missing one.
    return appointment.clinicId === request.clinicId
      ? { ok: true, showService: true }
      : { ok: false, reason: "not_found" };
  }
  const day = ticketDayState(appointment.date, now);
  if (day !== "today") {
    return { ok: false, reason: day === "past" ? "expired" : "not_today" };
  }
  // «ЭЭГ» next to initials is a medical fact: not for whoever holds the QR.
  return { ok: true, showService: false };
}

/** Opaque, stable join key for one appointment row on the public screens. */
export function boardRowKey(appointmentId: string): string {
  return appHmac(ROW_PURPOSE, appointmentId, 12);
}
