/**
 * Access decision for the /admin pages (SUPER_ADMIN control plane).
 *
 * `src/proxy.ts` does not run on /admin (its matcher leaves it out), so the
 * layout and every page that loads data on the server ask here (audit
 * SEC-08): the layout alone is not enough, because a soft navigation renders
 * only the page segment. A SUPER_ADMIN who has not enrolled 2FA yet is sent
 * to the enrolment page, never locked out: it lives in the CRM
 * (`/crm/me/security`), which the proxy and the TOTP endpoints already let a
 * SUPER_ADMIN without a clinic use.
 */
import { auth } from "@/lib/auth";
import { owesTotpEnrolment } from "@/server/auth/mfa-gate";
import {
  SECURITY_ENROL_SUBPATH,
  accountSurfaceFor,
} from "@/server/auth/staff-redirects";

/** Where a SUPER_ADMIN without 2FA goes (default locale, no prefix). */
export const SUPER_ADMIN_ENROL_PATH = `/${accountSurfaceFor("SUPER_ADMIN")}/${SECURITY_ENROL_SUBPATH}`;

export type AdminPageAccess =
  | { kind: "anonymous" }
  | { kind: "forbidden" }
  | { kind: "owes_mfa" }
  | { kind: "ok"; userId: string; name: string | null; email: string | null };

export async function adminPageAccess(): Promise<AdminPageAccess> {
  const session = await auth();
  if (!session?.user) return { kind: "anonymous" };
  if (session.user.role !== "SUPER_ADMIN") return { kind: "forbidden" };
  if (await owesTotpEnrolment(session.user.id, "SUPER_ADMIN")) {
    return { kind: "owes_mfa" };
  }
  return {
    kind: "ok",
    userId: session.user.id,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
  };
}
