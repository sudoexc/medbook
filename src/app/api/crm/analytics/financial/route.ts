/**
 * GET /api/crm/analytics/financial — today + month-to-date + naive forecast.
 *
 * Reads `mv_financial_pace` (see migration). Returns a per-day breakdown
 * for the active month, plus aggregate MTD totals and a linear month-end
 * forecast. The forecast is intentionally naive (MTD-collected scaled
 * to month length); W3 / W4 may swap in something better.
 *
 * RBAC: ADMIN.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { resolveFinancialPace } from "@/server/analytics/financial-pace-resolver";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async () => {
    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }
    const data = await resolveFinancialPace(prisma, ctx.clinicId);
    return ok({
      data,
      generatedAt: data.generatedAt,
      source: data.source,
    });
  },
);
