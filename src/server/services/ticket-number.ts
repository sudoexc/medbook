/**
 * Ticket numbering: doctor-id-prefix + zero-padded queue order.
 * Examples: "A-001", "B-042". Stays consistent across kiosk + TV + ticket.
 */
export function ticketNumberFor(
  doctorId: string,
  queueOrder: number | null | undefined,
): string {
  const prefix = doctorId.charAt(0).toUpperCase();
  const order = String(queueOrder ?? 0).padStart(3, "0");
  return `${prefix}-${order}`;
}
