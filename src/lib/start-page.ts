/**
 * Per-account start page (owner request 05.10.2026).
 *
 * The clinic's iPad reception account must open straight into the tablet
 * page (`/crm/reception/tablet`): after sign-in, and whenever it opens the
 * CRM root (the bare /crm, /crm/reception, a bookmark, the home screen icon).
 * Every other account keeps its role's usual home.
 *
 * `User.startPage` is a nullable string; only the values listed here are
 * honoured, and only for the roles they belong to, so a stale value left on
 * an account that later changed role does nothing.
 *
 * Pure and client-safe: the login forms, the proxy, the NextAuth callbacks,
 * the users API and the ops script share it.
 */
import type { Role } from "./tenant-context";

export const START_PAGES = ["reception-tablet"] as const;
export type StartPage = (typeof START_PAGES)[number];

/**
 * Who may have each start page. The tablet start page is also what opens
 * the tablet at all (lib/reception-tablet/access): only reception accounts
 * with it see or open /crm/reception/tablet, administrators included in the
 * «no» (owner request 05.10.2026).
 */
const START_PAGE_ROLES: Record<StartPage, readonly Role[]> = {
  "reception-tablet": ["RECEPTIONIST"],
};

/** Where each start page lives: `<surface>/<subpath>` under the locale. */
const START_PAGE_TARGET: Record<StartPage, string> = {
  "reception-tablet": "crm/reception/tablet",
};

/**
 * CRM subpaths that mean «open the CRM»: the bare /crm (which only forwards)
 * and the reception desk it forwards to. Anything deeper is a deliberate
 * destination and is never rerouted.
 */
const ENTRY_SUBPATHS: ReadonlySet<string> = new Set(["", "reception"]);

/** `?mode=desktop`: the tablet page's «Обычный режим» link. */
export const DESKTOP_MODE_PARAM = "mode";
export const DESKTOP_MODE_VALUE = "desktop";

/**
 * Session cookie that remembers the deliberate switch to the desktop
 * reception. No max-age, so it ends with the browser session; its value is
 * the UserSession id, so it also ends with the sign-in it was made in (a new
 * sign-in on the same iPad starts in tablet mode again, and another
 * account's leftover cookie never matches).
 */
export const START_PAGE_OVERRIDE_COOKIE = "crm_start_override";

export function parseStartPage(value: unknown): StartPage | null {
  return typeof value === "string" &&
    (START_PAGES as readonly string[]).includes(value)
    ? (value as StartPage)
    : null;
}

export function startPageAllowedFor(
  role: string | null | undefined,
  page: StartPage,
): boolean {
  return (START_PAGE_ROLES[page] as readonly string[]).includes(role ?? "");
}

/**
 * The start page that actually applies to an account: a whitelisted value
 * that belongs to the account's current role, or null.
 */
export function startPageFor(
  role: string | null | undefined,
  value: unknown,
): StartPage | null {
  const page = parseStartPage(value);
  return page && startPageAllowedFor(role, page) ? page : null;
}

/** `<surface>/<subpath>` under the locale, e.g. "crm/reception/tablet". */
export function startPageTarget(page: StartPage): string {
  return START_PAGE_TARGET[page];
}

/** Full path with the locale prefix, in the style of `homeForRole`. */
export function startPagePath(page: StartPage, locale: string = "ru"): string {
  const loc = locale === "uz" ? "uz" : "ru";
  return `/${loc}/${START_PAGE_TARGET[page]}`;
}

function trimSlashes(subpath: string): string {
  return subpath.replace(/^\/+|\/+$/g, "");
}

/**
 * Does opening this CRM page mean «open the CRM» (and so the start page)?
 * Only the bare entry paths, and only without a query: `?ap=…`, `?walkin=…`
 * and `?mode=desktop` are links made on purpose and must land where they
 * point.
 */
export function isStartPageEntry(
  surface: string,
  subpath: string,
  search: string,
): boolean {
  if (surface !== "crm") return false;
  if (!ENTRY_SUBPATHS.has(trimSlashes(subpath))) return false;
  return new URLSearchParams(search).toString() === "";
}

/** Value the override cookie must carry for this sign-in. */
export function overrideCookieValue(sessionId: string | null | undefined): string {
  // Sessions minted before JWTs carried their row id have none; they age out
  // within 24h, a constant is good enough for them.
  return sessionId ? sessionId : "1";
}

export type StartPageUpdatePlan =
  | { ok: true; write: false }
  | { ok: true; write: true; value: StartPage | null }
  | { ok: false; reason: "start_page_not_allowed" };

/**
 * Pure: what PATCH /api/crm/users/[id] does with `startPage`.
 *
 *   - not sent: nothing, except that an account leaving the role its start
 *     page belongs to has it cleared (no dead value lingers on the row);
 *   - null: cleared;
 *   - a start page: stored when it belongs to the account's role after the
 *     edit, refused otherwise.
 */
export function planStartPageUpdate(input: {
  nextRole: string;
  current: string | null | undefined;
  requested: StartPage | null | undefined;
}): StartPageUpdatePlan {
  const current = input.current ?? null;
  if (input.requested === undefined) {
    const page = parseStartPage(current);
    if (current !== null && !(page && startPageAllowedFor(input.nextRole, page))) {
      return { ok: true, write: true, value: null };
    }
    return { ok: true, write: false };
  }
  if (input.requested === null) {
    return current === null
      ? { ok: true, write: false }
      : { ok: true, write: true, value: null };
  }
  if (!startPageAllowedFor(input.nextRole, input.requested)) {
    return { ok: false, reason: "start_page_not_allowed" };
  }
  return input.requested === current
    ? { ok: true, write: false }
    : { ok: true, write: true, value: input.requested };
}
