"use client";

/**
 * Temporary role hook for Phase 2a UI gating.
 *
 * We don't have a client session provider yet (NextAuth `useSession` is not
 * wired — the CRM layout hardcodes admin in Phase 0). Until
 * `session-provider` lands (Phase 2c-ish alongside reception dashboard),
 * the Patient card uses this shim to:
 *  - default to ADMIN (show every tab)
 *  - allow override via `?role=RECEPTIONIST` query param for manual RBAC testing
 *
 * Server-side gating still lives in `createApiHandler({roles})` — this is
 * purely a UI convenience.
 */
export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

const ROLES: ReadonlySet<Role> = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
]);

export function useCurrentRole(): Role {
  if (typeof window === "undefined") return "ADMIN";
  const sp = new URLSearchParams(window.location.search);
  const override = sp.get("role")?.toUpperCase();
  if (override && ROLES.has(override as Role)) return override as Role;
  return "ADMIN";
}

export function canViewMedical(role: Role): boolean {
  return role !== "RECEPTIONIST" && role !== "CALL_OPERATOR";
}
