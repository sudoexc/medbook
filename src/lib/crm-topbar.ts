/**
 * What the CRM topbar shows for a session and a page (audit CM-26).
 *
 * The topbar showed every action to every role and plan: a nurse's big
 * «Выдать талон» (and F2) ended in 403 from the walk-in API, and the
 * «Звонки» / «Telegram» icons opened pages that answer notFound() on a plan
 * without those modules, which the sidebar already hides. The role lists
 * mirror the API gates they lead to; SUPER_ADMIN passes every role gate at
 * the API layer, so it does here too.
 *
 * The page title came from a segment map that missed several sections, and
 * a missing segment read «Ресепшн».
 *
 * Client-safe: no server imports.
 */
import { canUseCallCenter } from "@/lib/calls/roles";
import type { FeatureFlags } from "@/lib/feature-flags";

/** POST /api/crm/appointments/walkin reads this list too. */
export const WALKIN_TICKET_ROLES = ["ADMIN", "RECEPTIONIST", "DOCTOR"] as const;

/**
 * POST /api/crm/appointments and POST /api/crm/patients: the dropdown's
 * «Создать запись» / «Новый пациент» (CM-08 gave both to the call operator).
 */
export const BOOKING_ROLES = [
  "ADMIN",
  "RECEPTIONIST",
  "DOCTOR",
  "CALL_OPERATOR",
] as const;

export type TopbarActions = {
  /** The primary «Выдать талон» button and its F2 shortcut. */
  walkinTicket: boolean;
  /** «Создать запись» and «Новый пациент». */
  booking: boolean;
  calls: boolean;
  telegram: boolean;
};

function roleIn(role: string | null | undefined, list: readonly string[]): boolean {
  if (!role) return false;
  return role === "SUPER_ADMIN" || list.includes(role);
}

export function topbarActions(
  role: string | null | undefined,
  flags: Pick<FeatureFlags, "hasCallCenter" | "hasTelegramInbox">,
): TopbarActions {
  return {
    walkinTicket: roleIn(role, WALKIN_TICKET_ROLES),
    booking: roleIn(role, BOOKING_ROLES),
    // The call center page also tells a role the calls API refuses that it
    // is not theirs (CM-08); the topbar shortcut just stays away.
    calls: flags.hasCallCenter && canUseCallCenter(role),
    // The Telegram inbox API serves every CRM role; only the plan gates it.
    telegram: flags.hasTelegramInbox && Boolean(role),
  };
}

/**
 * URL segment after `/crm` → key under `crmShell.topbar.sections`. The two
 * diverge for kebab-case paths (camelCase translation keys) and for pages
 * that belong to another section.
 */
export const CRM_SECTION_KEY: Readonly<Record<string, string>> = {
  reception: "reception",
  "action-center": "actionCenter",
  "online-requests": "onlineRequests",
  appointments: "appointments",
  calendar: "calendar",
  patients: "patients",
  // A case is opened from the patient card.
  cases: "patients",
  doctors: "doctors",
  rooms: "rooms",
  services: "services",
  documents: "documents",
  "call-center": "callCenter",
  telegram: "telegram",
  notifications: "notifications",
  analytics: "analytics",
  settings: "settings",
  me: "account",
  tasks: "tasks",
};

/**
 * Section key for a pathname. With next-intl's `localePrefix: "as-needed"`
 * the default locale (`ru`) has no URL prefix, so the segment index differs
 * between `/crm/telegram` and `/uz/crm/telegram`: take the segment after
 * "crm" instead of a fixed index. `/crm` itself is the reception desk.
 */
export function crmSectionKey(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const crmIdx = parts.indexOf("crm");
  const segment = crmIdx >= 0 ? (parts[crmIdx + 1] ?? "reception") : "reception";
  return CRM_SECTION_KEY[segment] ?? "reception";
}
