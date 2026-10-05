/**
 * Where each role lands after a successful sign-in.
 *
 * The login form has no business deciding URLs per-role inline — we want one
 * source of truth so the regular form and the /login/2fa form behave the
 * same way. `safeCallbackOrHome` also enforces that a doctor cannot be sent
 * into the CRM surface (and vice-versa) by a stale or hostile `callbackUrl`
 * query param.
 *
 * An account with a start page (`User.startPage`, see `./start-page.ts`)
 * lands there instead of its role's home, e.g. the iPad reception account on
 * /crm/reception/tablet.
 */

import type { Role } from "./tenant-context";
import { isStartPageEntry, startPageFor, startPagePath } from "./start-page";

/** Path segment owned by each role, after the optional `/<locale>` prefix. */
const SURFACE_BY_ROLE: Record<Role, "doctor" | "crm" | "admin"> = {
  SUPER_ADMIN: "admin",
  ADMIN: "crm",
  DOCTOR: "doctor",
  RECEPTIONIST: "crm",
  NURSE: "crm",
  CALL_OPERATOR: "crm",
};

const LOCALES = ["ru", "uz"] as const;
type Locale = (typeof LOCALES)[number];

function normalizeLocale(input: string | null | undefined): Locale {
  return input === "uz" ? "uz" : "ru";
}

/**
 * Canonical home page for a given role + locale, or the account's start page
 * when it has one that belongs to its role.
 */
export function homeForRole(
  role: Role,
  locale: string = "ru",
  startPage?: string | null,
): string {
  const loc = normalizeLocale(locale);
  const page = startPageFor(role, startPage);
  if (page) return startPagePath(page, loc);
  const surface = SURFACE_BY_ROLE[role];
  if (surface === "admin") return "/admin/clinics";
  return `/${loc}/${surface}`;
}

/**
 * Split a same-origin path into `{ locale, surface, subpath, search }`.
 * Returns `null` for paths that aren't recognisable role surfaces (e.g.
 * `/login`, `/`).
 *
 * Examples:
 *   "/ru/doctor/patients" → { locale: "ru", surface: "doctor", subpath: "patients" }
 *   "/uz/crm?x=1"         → { locale: "uz", surface: "crm", subpath: "", search: "x=1" }
 *   "/admin/clinics/abc"  → { locale: "ru", surface: "admin", subpath: "clinics/abc" }
 *   "/login"              → null
 */
function parseSurface(path: string): {
  locale: Locale;
  surface: "doctor" | "crm" | "admin";
  subpath: string;
  search: string;
} | null {
  const [beforeHash] = path.split("#");
  const [pathname, search = ""] = beforeHash.split("?");
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  if (segs[0] === "admin") {
    return { locale: "ru", surface: "admin", subpath: segs.slice(1).join("/"), search };
  }
  if (segs.length < 2) return null;
  const [first, second] = segs;
  if (!LOCALES.includes(first as Locale)) return null;
  if (second === "doctor" || second === "crm") {
    return {
      locale: first as Locale,
      surface: second,
      subpath: segs.slice(2).join("/"),
      search,
    };
  }
  return null;
}

/**
 * Reject hostile `callbackUrl` values:
 *   - missing or not a string
 *   - absolute URLs (anything starting with a scheme or `//`)
 *   - URL-encoded schemes (e.g. `javascript:`)
 * Returns the input only when it's a safe same-origin path.
 */
function asSafePath(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  if (!value.startsWith("/")) return null;
  // Block protocol-relative `//evil.com/...`
  if (value.startsWith("//")) return null;
  return value;
}

/**
 * Resolve the final redirect target for a signed-in user.
 *
 * - If `callbackUrl` is safe AND points at the same surface as the user's
 *   role → honour it (preserves deep links like `/ru/doctor/conclusions/abc`).
 * - Otherwise → role's canonical home (cross-role callbackUrl gets upgraded,
 *   not silently followed).
 * - An account with a start page treats a callback to the bare CRM entry
 *   (`/ru/crm`, `/uz/crm/reception`, no query) like no callback at all: that
 *   is «open the CRM», and the proxy would send it on to the start page
 *   anyway. Deeper links, and `?mode=desktop`, are still honoured.
 */
export function safeCallbackOrHome(
  callbackUrl: string | null | undefined,
  role: Role,
  locale: string = "ru",
  startPage?: string | null,
): string {
  const home = homeForRole(role, locale, startPage);
  const safe = asSafePath(callbackUrl);
  if (!safe) return home;
  const parsed = parseSurface(safe);
  if (!parsed) return home;
  if (parsed.surface !== SURFACE_BY_ROLE[role]) return home;
  if (
    startPageFor(role, startPage) &&
    isStartPageEntry(parsed.surface, parsed.subpath, parsed.search)
  ) {
    return home;
  }
  return safe;
}
