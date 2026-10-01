/**
 * GET /api/crm/analytics/schedule-heatmap — per-doctor schedule heatmap.
 *
 * Counted live over the 90 days before today (schedule-heatmap-resolver.ts,
 * audit AN-24). Returns one cell per (doctorId, ISO dayOfWeek, Tashkent
 * hour) with visits, working hours and free working hours.
 *
 * RBAC: ADMIN.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { resolveScheduleHeatmap } from "@/server/analytics/schedule-heatmap-resolver";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async () => {
    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }
    const data = await resolveScheduleHeatmap(prisma, ctx.clinicId);
    return ok({
      data,
      generatedAt: data.generatedAt,
      source: data.source,
    });
  },
);
