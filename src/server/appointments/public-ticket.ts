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
const KIOSK_PRINT_PURPOSE = "kiosk-print-v1";

/** Our ids are cuids; anything else in the id half is not ours. */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function queueTicketToken(appointmentId: string): string {
  return `${appointmentId}.${appHmac(TICKET_PURPOSE, appointmentId)}`;
}

/**
 * The kiosk's own print key (audit Q-06, Q-09).
 *
 * The kiosk prints the stub in a hidden frame on its own page, and that
 * frame, like the old new tab, cannot send the device header. The queue
 * token would open the stub, but it is the QR's token too, so the stub it
 * opens leaves the service out («ЭЭГ» is not for whoever picks the slip
 * up). The patient who just chose «ЭЭГ» on the kiosk should see it on the
 * paper the kiosk hands her, like the front desk's slip.
 *
 * So the walk-in and check-in answers carry this second key: it is never
 * printed or put in a QR, it opens the stub with the service line, and it
 * dies `KIOSK_PRINT_TTL_MS` after issue (enough for the print and a reprint
 * from the «done» screen). The `k~` prefix keeps it apart from a queue token,
 * whose id half could otherwise be confused with it.
 */
export const KIOSK_PRINT_TTL_MS = 10 * 60_000;
const KIOSK_PRINT_PREFIX = "k~";

export function kioskPrintToken(appointmentId: string, now: Date = new Date()): string {
  const exp = Math.floor((now.getTime() + KIOSK_PRINT_TTL_MS) / 1000).toString(36);
  const sig = appHmac(KIOSK_PRINT_PURPOSE, `${appointmentId}.${exp}`);
  return `${KIOSK_PRINT_PREFIX}${appointmentId}.${exp}.${sig}`;
}

export type ParsedKioskPrintToken =
  | { kind: "print"; appointmentId: string }
  | { kind: "expired" }
  | { kind: "invalid" };

/** Null when `raw` is not shaped as a kiosk print key at all. */
export function parseKioskPrintToken(
  raw: string,
  now: Date = new Date(),
): ParsedKioskPrintToken | null {
  const value = (raw ?? "").trim();
  if (!value.startsWith(KIOSK_PRINT_PREFIX)) return null;
  const [appointmentId, exp, sig, ...rest] = value
    .slice(KIOSK_PRINT_PREFIX.length)
    .split(".");
  if (rest.length > 0 || !appointmentId || !exp || !sig) return { kind: "invalid" };
  if (!ID_RE.test(appointmentId) || !/^[0-9a-z]{1,12}$/.test(exp)) {
    return { kind: "invalid" };
  }
  if (!appHmacMatches(KIOSK_PRINT_PURPOSE, `${appointmentId}.${exp}`, sig)) {
    return { kind: "invalid" };
  }
  // Checked after the signature, so a forged key never learns about expiry.
  if (parseInt(exp, 36) * 1000 <= now.getTime()) return { kind: "expired" };
  return { kind: "print", appointmentId };
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
 * dot gave back «А. К., Султанов, ЭЭГ, 14:30». Two callers print it and the
 * QR leads back to it; each brings its own key:
 *
 *   - the front desk, from the CRM walk-in dialog, with a staff session: a
 *     bare id opens an appointment of the signed-in user's own clinic, on any
 *     day (a reprint), service line included;
 *   - the lobby kiosk, which has no session (its device token travels in a
 *     header its print frame cannot send): it opens the stub with the
 *     short-lived print key from its walk-in / check-in answer
 *     (`kioskPrintToken`), the appointment's day only, service line
 *     included (audit Q-06);
 *   - whoever holds the QR's signed ticket token (the patient's own Mini
 *     App too): the appointment's day only, and without the service line.
 *
 * Anything else, a bare id without a staff session included, is refused
 * before any lookup, so it cannot even tell whether the id exists.
 */
export type TicketStubRequest =
  | { kind: "lookup"; appointmentId: string; viewer: "staff"; clinicId: string }
  | { kind: "lookup"; appointmentId: string; viewer: "holder" | "kiosk" }
  | { kind: "refuse"; reason: "staff_only" | "not_found" | "expired" };

export async function resolveTicketStubRequest(
  ref: string,
  /** The signed-in staff member's clinic, or null. Asked only for a bare id. */
  staffClinicId: () => Promise<string | null>,
  now: Date = new Date(),
): Promise<TicketStubRequest> {
  const print = parseKioskPrintToken(ref, now);
  if (print) {
    if (print.kind === "print") {
      return { kind: "lookup", appointmentId: print.appointmentId, viewer: "kiosk" };
    }
    return { kind: "refuse", reason: print.kind === "expired" ? "expired" : "not_found" };
  }
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
  // The kiosk's print key never leaves the kiosk and dies in minutes, so the
  // slip it prints names the service the patient just chose (Q-06).
  return { ok: true, showService: request.viewer === "kiosk" };
}

/** Opaque, stable join key for one appointment row on the public screens. */
export function boardRowKey(appointmentId: string): string {
  return appHmac(ROW_PURPOSE, appointmentId, 12);
}
