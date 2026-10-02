/**
 * Who may send the staff reminder for a set of visits
 * (POST /api/crm/appointments/bulk-reminders): «Напомнить всем» on «Записи»
 * and «Отправить» on the reception's «Напоминания пациентам» card.
 *
 * The reception page is every CRM role's home, so the card reached the nurse
 * and the call operator too, and their «Отправить» was a sure 403 shown as
 * «Forbidden» (audit AP-14 review). The buttons read this set, the route
 * enforces it. Client-safe: no server imports.
 */

/** Roles the bulk-reminders route accepts (SUPER_ADMIN bypasses, as there). */
export const BULK_REMINDER_ROLES = ["ADMIN", "RECEPTIONIST"] as const;

export function canSendBulkReminders(role: string | null | undefined): boolean {
  if (!role) return false;
  return (
    role === "SUPER_ADMIN" ||
    (BULK_REMINDER_ROLES as readonly string[]).includes(role)
  );
}
