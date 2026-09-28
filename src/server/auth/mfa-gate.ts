/**
 * «Does this signed-in person still owe a second factor?», read from the
 * database, for every server surface that gates on it (audit SEC-08).
 *
 * `src/proxy.ts` answers the same question for staff pages, but its matcher
 * leaves out /api and /admin. Before SEC-08 the API layer asked it only for
 * ordinary clinic staff: grant-based impersonation was skipped (its 2FA was
 * said to live at a platform-login / grant layer that never existed), and the
 * platform control plane (/admin, /api/platform, /api/admin) checked the role
 * alone. So a leaked SUPER_ADMIN password was enough to reset any clinic
 * owner's password, enter any clinic in WRITE mode and read medical data.
 *
 * One helper, so the CRM API wrapper, the platform handlers and the /admin
 * layout cannot drift apart again. Pure policy stays in `security-policy.ts`.
 */
import { runWithTenant, type Role } from "@/lib/tenant-context";

import { is2faDisabled, requiresTotpEnrollment } from "./security-policy";

export const MFA_REQUIRED = "MFA_REQUIRED";

/** The 403 the SPA and scripts already know from `createApiHandler`. */
export function mfaRequiredResponse(): Response {
  return Response.json(
    {
      error: MFA_REQUIRED,
      message:
        "Two-factor authentication must be enabled before accessing this resource.",
    },
    { status: 403 },
  );
}

/**
 * True when `role` must have TOTP enrolled here and the account has not
 * enrolled yet. `role` is the session's (fresh from the database on every
 * request, see session-guard.ts); for an impersonating SUPER_ADMIN it is
 * SUPER_ADMIN, so their OWN enrolment is checked, not the clinic's setting.
 *
 * A missing user row counts as «not enrolled»: failing closed costs a
 * mandatory role nothing it could legitimately use.
 */
export async function owesTotpEnrolment(
  userId: string,
  role: Role,
): Promise<boolean> {
  if (is2faDisabled()) return false;
  // Dynamic import like the rest of the API wrapper: keeps the database
  // client out of the module graph until a request actually needs it.
  const { prisma } = await import("@/lib/prisma");
  // `User` is tenant-scoped by the Prisma extension; the caller's own row is
  // read under SYSTEM so the PK lookup is not subject to clinic scoping.
  const me = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        totpEnabledAt: true,
        clinic: { select: { require2faForAll: true } },
      },
    }),
  );
  const mustEnrol = requiresTotpEnrollment({
    role,
    clinicRequire2faForAll: me?.clinic?.require2faForAll ?? false,
  });
  return mustEnrol && !me?.totpEnabledAt;
}
