/**
 * Ticket numbering: doctor-id-prefix + zero-padded queue order.
 * Examples: "A-001", "B-042". Stays consistent across kiosk + TV + ticket.
 *
 * Returns `null` when there is no sequence to print — a booking whose visit
 * was started without a check-in never claimed a ticketSeq/queueOrder, and
 * padding the old `?? 0` fallback minted a fake "X-000" that no paper slip
 * ever carried. Callers render the null as "no ticket" instead.
 */
export function ticketNumberFor(
  doctorId: string,
  queueOrder: number | null | undefined,
): string | null {
  if (queueOrder == null) return null;
  const prefix = doctorId.charAt(0).toUpperCase();
  const order = String(queueOrder).padStart(3, "0");
  return `${prefix}-${order}`;
}
