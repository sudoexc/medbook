/**
 * Who works the call center: the desk, the call operators and the admin
 * (the `Call` row of the permission matrix). The calls API and the page
 * read the same list, so a role the API refuses is told so on the page
 * instead of watching an empty queue (audit CM-08).
 */
export const CALL_CENTER_ROLES = ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] as const;

export function canUseCallCenter(role: string | null | undefined): boolean {
  if (!role) return false;
  return (
    role === "SUPER_ADMIN" ||
    (CALL_CENTER_ROLES as readonly string[]).includes(role)
  );
}
