/**
 * Why a ticket's status page has nothing to wait for any more (audit Q-24).
 *
 * The page knew four states: waiting in the live lane, an arrived booking,
 * on the table, done. A ticket the desk SKIPPED (called, the patient had
 * stepped out), CANCELLED (the doctor's «Убрать из очереди») or marked
 * NO_SHOW matched none of them and kept the blue «active» card with an empty
 * status block, so the patient went on sitting in the corridor.
 */
export type TicketClosedReason = "skipped" | "cancelled" | "noShow";

export function ticketClosedReason(status: string): TicketClosedReason | null {
  switch (status) {
    case "SKIPPED":
      return "skipped";
    case "CANCELLED":
      return "cancelled";
    case "NO_SHOW":
      return "noShow";
    default:
      return null;
  }
}

/** The message keys (`queueStatusPage.*`) the page shows for a closed ticket. */
export function ticketClosedCopyKeys(
  reason: TicketClosedReason,
  lane: "live" | "schedule" | undefined,
): { title: string; hint: string } {
  if (reason === "skipped") return { title: "skipped", hint: "skippedHint" };
  if (reason === "noShow") return { title: "noShow", hint: "noShowHint" };
  // A booking is called off as a «запись»; a paper ticket leaves the queue.
  return {
    title: lane === "schedule" ? "cancelledBooking" : "cancelledLive",
    hint: "cancelledHint",
  };
}
