/**
 * GET /api/crm/analytics/financial — today + month-to-date + naive forecast.
 *
 * Reads `mv_financial_pace` (see migration). Returns a per-day breakdown
 * for `?days=N` Tashkent days back to today (1..90, default 90) through the
 * month end, the same window the page renders first (audit AN-25), plus
 * aggregate MTD totals and a linear month-end forecast. The forecast is
 * intentionally naive (MTD-collected scaled to month length); W3 / W4 may
 * swap in something better.
 *
 * RBAC: ADMIN.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import {
  FINANCIAL_TREND_DAYS,
  resolveFinancialPace,
} from "@/server/analytics/financial-pace-resolver";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }
    const daysParam = new URL(request.url).searchParams.get("days");
    const trendDays = daysParam ? Number(daysParam) : FINANCIAL_TREND_DAYS;
    const data = await resolveFinancialPace(prisma, ctx.clinicId, { trendDays });
    return ok({
      data,
      generatedAt: data.generatedAt,
      source: data.source,
    });
  },
);
