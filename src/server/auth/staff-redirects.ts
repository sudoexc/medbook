/**
 * Pure routing decisions of the staff-page gate in `src/proxy.ts`, kept here
 * so they can be unit-tested without Next's request objects (audit DC-02).
 */
import { shouldRedirectDoctorToCabinet } from "@/lib/doctor-cabinet";
import {
  DESKTOP_MODE_PARAM,
  DESKTOP_MODE_VALUE,
  isStartPageEntry,
  overrideCookieValue,
  startPageFor,
  startPageTarget,
} from "@/lib/start-page";

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

export type StartPageDecision =
  /** Send the request to the start page; `target` is under the locale. */
  | { kind: "redirect"; target: string }
  /** Let it through and set the desktop override cookie to `value`. */
  | { kind: "remember-desktop"; value: string }
  /** Let it through and drop the desktop override cookie. */
  | { kind: "forget-desktop" }
  | null;

/**
 * Pure: the per-account start page step of the staff-page gate (owner
 * request 05.10.2026, see src/lib/start-page.ts).
 *
 *   - the bare CRM entry (/crm, /crm/reception, no query) → the start page,
 *     unless this sign-in deliberately switched to the desktop reception;
 *   - `/crm/reception?mode=desktop` (the tablet's «Обычный режим») → let it
 *     through and remember the switch, so the sidebar's «Ресепшн» does not
 *     bounce the receptionist back to the tablet;
 *   - the start page itself → forget the switch: back in tablet mode, the
 *     next visit to the CRM root opens the tablet again.
 *
 * The cookie only ever changes on a page load (`pageLoad`, see
 * `isTopLevelPageLoad`). Link prefetches and the App Router's own fetches
 * reach the proxy too; when they could write it, a prefetched «Обычный
 * режим» link turned desktop mode on for the whole sign-in, and a prefetched
 * «Режим планшета» link turned it off again (review 05.10.2026). Both
 * switches are therefore full page loads, which also drop the router's
 * cached prefetches, so no redirect cached under the old mode survives.
 * The redirect itself has no side effect and applies to every request.
 *
 * Accounts without a start page are never touched (no cookie either).
 */
export function startPageDecision(args: {
  surface: "crm" | "doctor";
  subpath: string;
  /** `request.nextUrl.search`: "" or "?…". */
  search: string;
  role: string | undefined;
  startPage: string | null | undefined;
  sessionId: string | null | undefined;
  overrideCookie: string | null | undefined;
  /** The browser is loading this page itself (`isTopLevelPageLoad`). */
  pageLoad: boolean;
}): StartPageDecision {
  const page = startPageFor(args.role, args.startPage);
  if (!page || args.surface !== "crm") return null;
  const subpath = args.subpath.replace(/^\/+|\/+$/g, "");
  const target = startPageTarget(page);
  const want = overrideCookieValue(args.sessionId);

  if (`${args.surface}/${subpath}` === target) {
    return args.overrideCookie && args.pageLoad ? { kind: "forget-desktop" } : null;
  }
  const params = new URLSearchParams(args.search);
  if (
    params.get(DESKTOP_MODE_PARAM) === DESKTOP_MODE_VALUE &&
    isStartPageEntry(args.surface, subpath, "")
  ) {
    return args.overrideCookie === want || !args.pageLoad
      ? null
      : { kind: "remember-desktop", value: want };
  }
  if (!isStartPageEntry(args.surface, subpath, args.search)) return null;
  if (args.overrideCookie === want) return null;
  return { kind: "redirect", target };
}

/** The subset of `Headers` the page load check reads. */
type HeaderSource = { get(name: string): string | null };

// Speculative loads announce themselves: `Sec-Purpose: prefetch` (and
// `prefetch;prerender`) in current browsers, `Purpose`, `X-Purpose` and
// `X-Moz` in older ones.
const SPECULATIVE_HEADERS = ["sec-purpose", "purpose", "x-purpose", "x-moz"];
const SPECULATIVE = /prefetch|prerender|preview/i;

/**
 * Pure: is this request the browser loading the page itself (a typed URL, a
 * bookmark, the home screen icon, a plain link, a reload), rather than a Link
 * prefetch or a client-side navigation fetching an RSC payload?
 *
 * WHY Fetch Metadata and not Next's headers: Next deletes its flight headers
 * (`rsc`, `next-router-prefetch`, `next-router-segment-prefetch`, …) from the
 * request before the proxy runs (next/dist/server/web/adapter.js, unless
 * skipProxyUrlNormalize is on), so a prefetch and a click look the same
 * here. The browser's own `Sec-Fetch-Dest` does tell them apart: `document`
 * for a page load, `empty` for every fetch the router makes. The flight
 * headers are still refused, so turning skipProxyUrlNormalize on later does
 * not reopen the hole. Browsers without Fetch Metadata (Safari before 16.4)
 * fall back to the Accept header: a page load asks for HTML, the router
 * sends no Accept at all.
 */
export function isTopLevelPageLoad(headers: HeaderSource): boolean {
  for (const name of SPECULATIVE_HEADERS) {
    if (SPECULATIVE.test(headers.get(name) ?? "")) return false;
  }
  if (headers.get("rsc") !== null || headers.get("next-router-prefetch") !== null) {
    return false;
  }
  const dest = headers.get("sec-fetch-dest");
  if (dest !== null) return dest === "document";
  return (headers.get("accept") ?? "").includes("text/html");
}
