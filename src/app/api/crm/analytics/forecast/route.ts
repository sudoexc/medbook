/**
 * /api/crm/analytics/forecast — 30-day forward revenue forecast for the
 * /crm/analytics/forecast dashboard (Phase 14, Wave 3).
 *
 * Server returns the baseline `ForecastPoint[]` (low/baseline/high). The
 * client then re-applies what-if sliders locally via `applyWhatIfSliders`
 * — no round-trip on slider drag.
 *
 * RBAC: ADMIN only (sensitive forward projection).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { loadForecast } from "@/server/revenue/forecast-data";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async () => {
    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return Response.json(
        { error: "ClinicNotSelected" },
        { status: 400 },
      );
    }

    const data = await loadForecast(ctx.clinicId);
    return ok(data);
  },
);
