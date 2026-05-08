/**
 * Phase 18 Wave 4 — list / create scheduled deliveries for one saved report.
 *
 * Routes:
 *   GET  /api/crm/analytics/reports/[id]/schedules
 *   POST /api/crm/analytics/reports/[id]/schedules
 */
import { auth } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { computeNextRunAt } from "@/server/analytics/cadence";
import { CreateScheduleBodySchema } from "@/server/analytics/schedule-validation";
import { err, notFound, ok } from "@/server/http";

export const runtime = "nodejs";

const DEFAULT_TZ = "Asia/Tashkent";

function reportIdFromUrl(request: Request): string {
  // /api/crm/analytics/reports/[id]/schedules
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  const reportId = reportIdFromUrl(request);
  return runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    async () => {
      const saved = await prisma.savedReport.findFirst({
        where: { id: reportId },
        select: { id: true },
      });
      if (!saved) return notFound();
      const rows = await prisma.scheduledReport.findMany({
        where: { savedReportId: reportId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          cadence: true,
          deliveryChannel: true,
          deliveryTarget: true,
          format: true,
          enabled: true,
          nextRunAt: true,
          lastDeliveredAt: true,
          lastFailureReason: true,
          consecutiveFailures: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return ok({
        rows: rows.map((r) => ({
          ...r,
          nextRunAt: r.nextRunAt.toISOString(),
          lastDeliveredAt: r.lastDeliveredAt
            ? r.lastDeliveredAt.toISOString()
            : null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      });
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = CreateScheduleBodySchema.safeParse(json);
  if (!parsed.success) {
    return err("ValidationError", 422, { issues: parsed.error.issues });
  }

  const reportId = reportIdFromUrl(request);
  const ctx = {
    kind: "TENANT" as const,
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  return runWithTenant(ctx, async () => {
    const saved = await prisma.savedReport.findFirst({
      where: { id: reportId },
      select: { id: true },
    });
    if (!saved) return notFound();

    const now = new Date();
    const nextRunAt = computeNextRunAt(parsed.data.cadence, now, DEFAULT_TZ);

    const created = await prisma.scheduledReport.create({
      data: {
        clinicId: ctx.clinicId,
        savedReportId: reportId,
        cadence: parsed.data.cadence,
        deliveryChannel: parsed.data.deliveryChannel,
        deliveryTarget: parsed.data.deliveryTarget.trim(),
        format: parsed.data.format,
        // Disabled-by-default per spec — but spec also accepts an explicit
        // enabled:true on create. The W4 brief says "Disabled-by-default";
        // honour the explicit override only if provided.
        enabled: parsed.data.enabled ?? false,
        nextRunAt,
      } as never,
      select: {
        id: true,
        cadence: true,
        deliveryChannel: true,
        deliveryTarget: true,
        format: true,
        enabled: true,
        nextRunAt: true,
        createdAt: true,
      },
    });

    await audit(request, {
      action: AUDIT_ACTION.SCHEDULED_REPORT_CREATED,
      entityType: "ScheduledReport",
      entityId: created.id,
      meta: {
        savedReportId: reportId,
        cadence: parsed.data.cadence,
        deliveryChannel: parsed.data.deliveryChannel,
        deliveryTarget: parsed.data.deliveryTarget.trim(),
        format: parsed.data.format,
        enabled: parsed.data.enabled ?? false,
      },
    });

    return ok(
      {
        id: created.id,
        cadence: created.cadence,
        deliveryChannel: created.deliveryChannel,
        deliveryTarget: created.deliveryTarget,
        format: created.format,
        enabled: created.enabled,
        nextRunAt: created.nextRunAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
      },
      201,
    );
  });
}
