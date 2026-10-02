/**
 * Pure routing decisions of the staff-page gate in `src/proxy.ts`, kept here
 * so they can be unit-tested without Next's request objects (audit DC-02).
 */
import { shouldRedirectDoctorToCabinet } from "@/lib/doctor-cabinet";

// /crm, /doctor and their /<locale>/ variants — capture the locale (if
// present), the surface and the subpath beneath it.
const STAFF_PATH = /^(?:\/(ru|uz))?\/(crm|doctor)(?:\/(.*))?$/;

// Subpaths the forced redirects must NOT loop on: the user has to be able to
// open (and submit) these while a redirect is pending. The same subpaths
// exist under /crm and /doctor.
export const CHANGE_PASSWORD_SUBPATH = "me/change-password";
export const SECURITY_ENROL_SUBPATH = "me/security";

export type StaffPath = {
  locale: "ru" | "uz";
  surface: "crm" | "doctor";
  subpath: string;
};

export function parseStaffPath(pathname: string): StaffPath | null {
  const m = STAFF_PATH.exec(pathname);
  if (!m) return null;
  return {
    locale: m[1] === "uz" ? "uz" : "ru",
    surface: m[2] as "crm" | "doctor",
    subpath: m[3] ?? "",
  };
}

export function isExemptFromForcedRedirect(
  subpath: string,
  exemptList: string[],
): boolean {
  return exemptList.some((p) => subpath === p || subpath.startsWith(`${p}/`));
}

/**
 * Which staff surface owns the account pages (password, 2FA) for this role:
 * a doctor's live in the cabinet while it is enabled, everyone else's in the
 * CRM. The CRM layout bounces doctors to /doctor, so sending a doctor to
 * /crm/me/… is a dead end.
 */
export function accountSurfaceFor(role: string | undefined): "crm" | "doctor" {
  return shouldRedirectDoctorToCabinet(role) ? "doctor" : "crm";
}

export type ForcedRedirect =
  | { kind: "change-password"; target: string }
  | { kind: "security"; target: string }
  | null;

/**
 * Where (if anywhere) a signed-in user on a staff page must be sent before
 * they can continue. `target` is the path under the locale prefix, e.g.
 * "doctor/me/change-password".
 */
export function forcedAccountRedirect(args: {
  subpath: string;
  role: string | undefined;
  mustChangePassword: boolean;
  owesTotpEnrolment: boolean;
}): ForcedRedirect {
  const surface = accountSurfaceFor(args.role);
  if (
    args.mustChangePassword &&
    !isExemptFromForcedRedirect(args.subpath, [CHANGE_PASSWORD_SUBPATH])
  ) {
    return {
      kind: "change-password",
      target: `${surface}/${CHANGE_PASSWORD_SUBPATH}`,
    };
  }
  if (
    args.owesTotpEnrolment &&
    !isExemptFromForcedRedirect(args.subpath, [
      SECURITY_ENROL_SUBPATH,
      CHANGE_PASSWORD_SUBPATH,
    ])
  ) {
    return { kind: "security", target: `${surface}/${SECURITY_ENROL_SUBPATH}` };
  }
  return null;
}

/** The account pages (password, 2FA) every staff role keeps under "me/". */
export const ACCOUNT_SUBPATH = "me";

/**
 * Pure: a SUPER_ADMIN on a CRM page without a clinic belongs on
 * /admin/clinics (audit G5-09). That is where a clinic visit leaves them
 * once its 60 minute lease runs out: the JWT drops the clinic, every CRM API
 * answers 400 ClinicNotSelected, and the operator used to keep clicking
 * through an empty CRM. The account pages under /crm/me stay reachable: they
 * are the SUPER_ADMIN's own password and 2FA screens.
 */
export function sendsSuperAdminToPlatform(args: {
  surface: "crm" | "doctor";
  subpath: string;
  role: string | undefined;
  clinicId: string | null | undefined;
}): boolean {
  return (
    args.surface === "crm" &&
    args.role === "SUPER_ADMIN" &&
    !args.clinicId &&
    !isExemptFromForcedRedirect(args.subpath, [ACCOUNT_SUBPATH])
  );
}
