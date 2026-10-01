/**
 * GET /api/crm/analytics/doctors — ranked doctor performance.
 *
 * Returns one row per doctor, aggregated over the exact requested window
 * (`doctor-performance-resolver.ts`). The window is no longer truncated to
 * whole months (audit AN-03).
 *
 * Query params:
 *   ?from=<ISO instant>    inclusive lower bound (a Tashkent midnight from
 *                          `resolveDoctorPerfRange`)
 *   ?to=<ISO instant>      exclusive upper bound
 *   ?monthFrom / ?monthTo  older names of the same two bounds
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
    const from = parseDate(
      url.searchParams.get("from") ?? url.searchParams.get("monthFrom"),
    );
    const to = parseDate(
      url.searchParams.get("to") ?? url.searchParams.get("monthTo"),
    );
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
        from: from ?? undefined,
        to: to ?? undefined,
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
