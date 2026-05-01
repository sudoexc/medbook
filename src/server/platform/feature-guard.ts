/**
 * Phase 9d — Server-side feature-flag guard for API route handlers.
 *
 * Mirrors the page.tsx `notFound()` guards: when a TENANT request hits a
 * paid-only endpoint without the matching flag, we return **404** rather
 * than 403 so the response is indistinguishable from a non-existent route.
 * This avoids leaking the existence of a pro feature to a basic-tier admin
 * — matches Stripe's "feature dark-launch" pattern.
 *
 * SUPER_ADMIN: bypasses the gate. The /admin surface is platform-level and
 * has no tenant plan to honour; the API handlers that mutate tenant data
 * already block SUPER_ADMIN with `ClinicNotSelected` upstream.
 */
import "server-only";

import { getFeatureFlags, type FeatureFlags } from "@/lib/feature-flags";
import type { TenantContext } from "@/lib/tenant-context";

type FeatureKey = "hasTelegramInbox" | "hasCallCenter" | "hasAnalyticsPro";

/**
 * Return a 404 `Response` when the current TENANT lacks `feature`.
 * Returns `null` when the request may proceed.
 *
 * Designed to be called at the top of an `createApiHandler` body:
 *
 *   const block = await ensureFeature(ctx, "hasCallCenter");
 *   if (block) return block;
 */
export async function ensureFeature(
  ctx: TenantContext,
  feature: FeatureKey
): Promise<Response | null> {
  if (ctx.kind !== "TENANT") return null; // SUPER_ADMIN / SYSTEM bypass.
  const flags: FeatureFlags = await getFeatureFlags(ctx.clinicId);
  if (flags[feature]) return null;
  return Response.json({ error: "NotFound" }, { status: 404 });
}
