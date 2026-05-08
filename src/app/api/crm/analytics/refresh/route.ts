/**
 * POST /api/crm/analytics/refresh — manual analytics MV refresh.
 *
 * Phase 18 Wave 1. ADMIN-only. Refreshes all four analytics materialized
 * views synchronously. The hourly cron does this automatically; this
 * endpoint exists for "I just imported a big batch and don't want to
 * wait an hour" cases.
 *
 * Audited as ANALYTICS_VIEWS_REFRESHED (manual triggers only — the cron
 * deliberately does not audit to avoid spamming the AuditLog with 24
 * meaningless rows per day).
 */
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { refreshAllAnalyticsMvs } from "@/server/workers/analytics-refresh";

export const POST = createApiHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const result = await refreshAllAnalyticsMvs(prisma);
    await audit(request, {
      action: AUDIT_ACTION.ANALYTICS_VIEWS_REFRESHED,
      entityType: "AnalyticsView",
      entityId: null,
      meta: {
        totalMs: result.totalMs,
        perView: result.perView,
        failures: result.failures,
      },
    });
    return ok(result);
  },
);
