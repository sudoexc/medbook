/**
 * Shared helpers for the Action Center REST mutation handlers.
 *
 * Each `[id]/snooze`, `[id]/dismiss`, `[id]/done`, `[id]/reopen` route shares
 * the same pattern: load the row, run a guard, perform the update, emit
 * audit. The guard logic and id parsing are factored here so the route
 * files stay short and readable.
 */
import type { TenantContext } from "@/lib/tenant-context";

/** Parse the trailing `[id]` segment from `/api/crm/actions/<id>/<verb>`. */
export function actionIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // Path tail looks like `actions/<id>/<verb>` — the id is two segments
  // before the last (which is the verb). We walk back to find it explicitly
  // so the helper is robust to extra suffixes.
  for (let i = parts.length - 1; i >= 1; i--) {
    if (parts[i - 1] === "actions") return parts[i];
  }
  return "";
}

/**
 * Compute "tomorrow at 09:00 local" given the current time. We anchor to
 * 09:00 because that's the canonical "start of business day" for the CRM.
 */
function tomorrowAt9(now: Date): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(9, 0, 0, 0);
  return next;
}

function nextWeek(now: Date): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

/**
 * Resolve a snooze preset to an absolute Date. Centralised so both the
 * route handler and tests reference the same offsets.
 */
export function resolveSnoozePreset(
  preset: "1h" | "4h" | "tomorrow" | "next-week",
  now: Date = new Date(),
): Date {
  switch (preset) {
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "4h":
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    case "tomorrow":
      return tomorrowAt9(now);
    case "next-week":
      return nextWeek(now);
    default: {
      const _exhaustive: never = preset;
      throw new Error(`resolveSnoozePreset: unknown preset ${_exhaustive as string}`);
    }
  }
}

/**
 * Audit `actorRole` value for a tenant context. SUPER_ADMIN with an active
 * impersonation is normalised to TENANT in `api-handler.ts` so we only need
 * to handle the TENANT case here.
 */
export function actorRoleFromContext(ctx: TenantContext): string | null {
  if (ctx.kind === "TENANT") return ctx.role;
  if (ctx.kind === "SUPER_ADMIN") return "SUPER_ADMIN";
  return null;
}
