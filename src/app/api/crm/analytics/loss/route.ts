/**
 * /api/crm/analytics/loss — revenue loss aggregation for the
 * /crm/analytics/loss dashboard (Phase 14, Wave 3).
 *
 * Returns the four loss sources (empty slots, no-shows, late cancellations,
 * dormant patients) over a selectable date range. Uses
 * `loadLossDashboard()` which delegates the math to the pure helpers in
 * `src/lib/revenue/loss-aggregation.ts`.
 *
 * Range resolution mirrors `/api/crm/analytics`: `?period=week|month|quarter`
 * or explicit `?from=&to=` ISO dates. Defaults to the last 30 days.
 *
 * RBAC: ADMIN only. Loss data is sensitive enough that we don't yet expose
 * it to DOCTOR scope (they would see clinic-wide totals which they
 * shouldn't). Wave 4 may add a per-doctor mode.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { resolveAnalyticsRange } from "@/server/analytics/range";
import { loadLossDashboard } from "@/server/revenue/loss-data";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const url = new URL(request.url);
    const { from, to, period } = resolveAnalyticsRange(url);

    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return Response.json(
        { error: "ClinicNotSelected" },
        { status: 400 },
      );
    }

    const data = await loadLossDashboard(ctx.clinicId, from, to);

    return ok({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      ...data,
    });
  },
);
