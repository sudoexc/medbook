/**
 * GET /api/crm/analytics/doctors — ranked doctor performance.
 *
 * Reads from `mv_doctor_performance` (see migration). Returns one row per
 * doctor, aggregated across the requested month range.
 *
 * Query params:
 *   ?monthFrom=YYYY-MM-DD  inclusive month-truncated lower bound
 *   ?monthTo=YYYY-MM-DD    exclusive month-truncated upper bound
 *   ?sortBy=               revenueTiins | visitsCount | noShowCount | npsAvg
 *   ?limit=                1..500 (default 50)
 *
 * RBAC: ADMIN. The resolver passes clinicId explicitly so a stray ctx
 * can't cross tenants.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import { getTenant } from "@/lib/tenant-context";
import { resolveDoctorPerformance } from "@/server/analytics/doctor-performance-resolver";

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const ctx = getTenant();
    if (ctx?.kind !== "TENANT") {
      return err("ClinicNotSelected", 400);
    }
    const url = new URL(request.url);
    const monthFrom = parseDate(url.searchParams.get("monthFrom"));
    const monthTo = parseDate(url.searchParams.get("monthTo"));
    const sortByRaw = url.searchParams.get("sortBy");
    const sortBy =
      sortByRaw === "visitsCount" ||
      sortByRaw === "noShowCount" ||
      sortByRaw === "npsAvg" ||
      sortByRaw === "revenueTiins"
        ? sortByRaw
        : undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const data = await resolveDoctorPerformance(
      prisma,
      ctx.clinicId,
      {
        monthFrom: monthFrom ?? undefined,
        monthTo: monthTo ?? undefined,
        sortBy,
        limit,
      },
    );
    return ok({
      data,
      generatedAt: data.generatedAt,
      source: data.source,
    });
  },
);
