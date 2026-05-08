/**
 * GET /api/crm/analytics/cohorts — patient cohort retention matrix.
 *
 * Phase 18 Wave 1 foundation read endpoint. Returns a flat matrix the W2
 * dashboard heatmap can render directly. Reads from `mv_cohort_retention`
 * (24-month sliding window — see migration).
 *
 * RBAC: ADMIN. Tenant scope is auto-applied via the AsyncLocalStorage ctx
 * — the resolver passes `clinicId` as the bound parameter so a leaking
 * ctx can't expose another clinic's matrix.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { resolveCohortRetention } from "@/server/analytics/cohort-resolver";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async () => {
    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }
    const data = await resolveCohortRetention(prisma, ctx.clinicId);
    return ok({
      data,
      generatedAt: data.generatedAt,
      source: data.source,
    });
  },
);
