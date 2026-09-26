/**
 * Ticket numbering: the doctor's ticket letter + zero-padded ticket sequence.
 * Examples: "A-001", "B-042". Every surface that shows a queue ticket (paper
 * stub, TV boards, kiosk, the doctor's screens, the `queue.called` event, the
 * walk-in response) goes through `ticketNumberFor`, so they cannot disagree.
 *
 * The letter is `Doctor.ticketPrefix`, stored and unique within the clinic
 * (audit Q-12). It used to be the first character of the doctor's id, and
 * cuid ids all start with "c": both neurologists handed out C-001, C-002…
 * at the same time, and the board calling «C-005» stood up two patients.
 * A stored letter stays put when doctors are added, renamed or moved to
 * another cabinet, and the admin can change it on the doctor's page.
 *
 * Returns `null` when there is no sequence to print — a booking whose visit
 * was started without a check-in never claimed a ticketSeq/queueOrder, and
 * padding the old `?? 0` fallback minted a fake "X-000" that no paper slip
 * ever carried. Callers render the null as "no ticket" instead.
 *
 * Pure: imported by client components too.
 */

/** What a caller must know about the doctor to print a ticket. */
export type TicketDoctor = { ticketPrefix: string | null };

/**
 * Letters handed out automatically, in order. I and O are left out: on a
 * thermal slip «I-010» and «O-010» read as numbers. An admin may still pick
 * either by hand.
 */
export const TICKET_PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** One or two Latin capitals — short enough to call out and to print big. */
export const TICKET_PREFIX_RE = /^[A-Z]{1,2}$/;

export function ticketNumberFor(
  doctor: TicketDoctor,
  queueOrder: number | null | undefined,
): string | null {
  if (queueOrder == null) return null;
  const order = String(queueOrder).padStart(3, "0");
  // A doctor without a letter yet (created before letters existed, until
  // scripts/fix-q12-ticket-prefixes.ts runs) prints the bare number rather
  // than a letter some other doctor may own.
  return doctor.ticketPrefix ? `${doctor.ticketPrefix}-${order}` : order;
}

/**
 * Admin input → stored form: trimmed, upper-cased. Returns `null` for input
 * that is not one or two Latin letters, so the caller can refuse it.
 */
export function normalizeTicketPrefix(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return TICKET_PREFIX_RE.test(v) ? v : null;
}

/**
 * The first letter not yet used in the clinic: single letters in alphabet
 * order, then pairs (AA, AB, …) for a clinic with more doctors than letters.
 * Deterministic for a given set of taken letters.
 */
export function nextTicketPrefix(taken: Iterable<string | null>): string {
  const used = new Set<string>();
  for (const p of taken) if (p) used.add(p);
  for (const a of TICKET_PREFIX_ALPHABET) {
    if (!used.has(a)) return a;
  }
  for (const a of TICKET_PREFIX_ALPHABET) {
    for (const b of TICKET_PREFIX_ALPHABET) {
      if (!used.has(a + b)) return a + b;
    }
  }
  // 24 + 576 doctors in one clinic: not a real clinic.
  throw new Error("ticket prefixes exhausted");
}
