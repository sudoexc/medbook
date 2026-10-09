/**
 * «Админ клиники» for a gate: the clinic's own ADMIN, or the platform owner
 * (SUPER_ADMIN) inside a clinic he entered.
 *
 * Owner request 09.10.2026 (docs/design/OWNER-ACCOUNT.md §0, §2): inside a
 * clinic the owner saw less than the clinic's admin, because the screens and
 * a few API routes asked `role === "ADMIN"` and SUPER_ADMIN is not ADMIN.
 * Use this for checks that mean «may act as this clinic's admin».
 *
 * Do not use it for checks about a staff RECORD holding the ADMIN role (the
 * last admin guard, role editing, the role list of a user form): those are
 * about another account's stored role, not about the caller.
 *
 * Opening a gate to SUPER_ADMIN does not open writes in a read only visit:
 * createApiHandler and `assertNotViewOnly` (src/lib/view-only-guard.ts) still
 * refuse every mutating request of a VIEW_ONLY grant.
 *
 * Client-safe: no server imports.
 */
export function isClinicAdmin(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * The role CRM screens gate on: the owner inside a clinic is shown the
 * clinic admin's screens, as the sidebar already did (crm/layout.tsx).
 * Every other role passes through unchanged.
 */
export function clinicViewRole<R extends string>(role: R): R | "ADMIN" {
  return role === "SUPER_ADMIN" ? "ADMIN" : role;
}
