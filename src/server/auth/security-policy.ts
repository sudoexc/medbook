/**
 * Phase 17 Wave 2 — Pure security-policy predicates.
 *
 * Lives separately from `session-security.ts` (which deals with session
 * lifetime) so the proxy and the security UI can both import without
 * pulling in DB or Date math.
 */
import type { Role } from "@/lib/tenant-context";

/**
 * Roles for which TOTP enrolment is ALWAYS required, regardless of the
 * clinic-level `require2faForAll` setting. Privileged seats: an attacker
 * who phishes one of these can move money, change permissions, or read
 * every patient. Cheaper to demand a token than to recover from a breach.
 */
const MANDATORY_2FA_ROLES: ReadonlySet<Role> = new Set<Role>([
  "SUPER_ADMIN",
  "ADMIN",
]);

export function isMandatory2faRole(role: Role): boolean {
  return MANDATORY_2FA_ROLES.has(role);
}

/**
 * Global kill-switch for two-factor authentication. When `DISABLE_2FA=1`
 * is set, the login authorize callback skips the TOTP/recovery gate, the
 * proxy stops forcing enrolment, and the pre-flight `totp-required`
 * endpoint always reports `false`. Intended for dev environments and
 * short-term ops bypass; flip back to `0`/unset to restore enforcement.
 */
export function is2faDisabled(): boolean {
  const v = process.env.DISABLE_2FA;
  return v === "1" || v === "true";
}

/**
 * Decide whether `role` (in `clinicRequire2faForAll` clinic) must have TOTP
 * enrolled. Returns true → the proxy must redirect to /crm/me/security/enroll
 * if the user has no `totpEnabledAt`.
 */
export function requiresTotpEnrollment(args: {
  role: Role;
  clinicRequire2faForAll: boolean;
}): boolean {
  if (is2faDisabled()) return false;
  if (isMandatory2faRole(args.role)) return true;
  return args.clinicRequire2faForAll;
}
