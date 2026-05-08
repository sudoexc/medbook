/**
 * Phase 18 Wave 4 — update / delete a single ScheduledReport.
 */
import { auth } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { computeNextRunAt } from "@/server/analytics/cadence";
import {
  UpdateScheduleBodySchema,
  isValidEmail,
  isValidTelegramChatId,
} from "@/server/analytics/schedule-validation";
import { err, notFound, ok } from "@/server/http";

export const runtime = "nodejs";
const DEFAULT_TZ = "Asia/Tashkent";

function idsFromUrl(request: Request): { reportId: string; scheduleId: string } {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../reports/[id]/schedules/[scheduleId]
  return {
    scheduleId: parts[parts.length - 1] ?? "",
    reportId: parts[parts.length - 3] ?? "",
  };
}

export async function PATCH(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  const { reportId, scheduleId } = idsFromUrl(request);
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = UpdateScheduleBodySchema.safeParse(json);
  if (!parsed.success) {
    return err("ValidationError", 422, { issues: parsed.error.issues });
  }

  return runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    async () => {
      const existing = await prisma.scheduledReport.findFirst({
        where: { id: scheduleId, savedReportId: reportId },
        select: {
          id: true,
          cadence: true,
          deliveryChannel: true,
          deliveryTarget: true,
          format: true,
          enabled: true,
        },
      });
      if (!existing) return notFound();

      const data: Record<string, unknown> = {};
      let recomputeNext = false;
      const newCadence = parsed.data.cadence ?? existing.cadence;
      const newChannel = parsed.data.deliveryChannel ?? existing.deliveryChannel;
      const newTarget = parsed.data.deliveryTarget ?? existing.deliveryTarget;

      // Channel/target pair revalidation against the merged record so
      // half-updates (e.g. "change channel only") still validate.
      if (parsed.data.deliveryChannel || parsed.data.deliveryTarget) {
        const trimmed = newTarget.trim();
        if (newChannel === "EMAIL" && !isValidEmail(trimmed)) {
          return err("ValidationError", 422, {
            issues: [{ path: ["deliveryTarget"], message: "invalid_email" }],
          });
        }
        if (newChannel === "TELEGRAM" && !isValidTelegramChatId(trimmed)) {
          return err("ValidationError", 422, {
            issues: [
              { path: ["deliveryTarget"], message: "invalid_telegram_chat_id" },
            ],
          });
        }
        data.deliveryChannel = newChannel;
        data.deliveryTarget = trimmed;
      }

      if (parsed.data.cadence && parsed.data.cadence !== existing.cadence) {
        data.cadence = parsed.data.cadence;
        recomputeNext = true;
      }
      if (parsed.data.format && parsed.data.format !== existing.format) {
        data.format = parsed.data.format;
      }
      if (parsed.data.enabled !== undefined) {
        data.enabled = parsed.data.enabled;
        // Re-enabling a previously-disabled-after-failures schedule should
        // also reset the failure counter so the worker doesn't immediately
        // redisable on the next miss.
        if (parsed.data.enabled === true) {
          data.consecutiveFailures = 0;
          data.lastFailureReason = null;
        }
      }

      if (recomputeNext) {
        data.nextRunAt = computeNextRunAt(newCadence, new Date(), DEFAULT_TZ);
      }

      if (Object.keys(data).length === 0) {
        return ok({ id: scheduleId, unchanged: true });
      }

      const updated = await prisma.scheduledReport.update({
        where: { id: scheduleId },
        data: data as never,
        select: {
          id: true,
          cadence: true,
          deliveryChannel: true,
          deliveryTarget: true,
          format: true,
          enabled: true,
          nextRunAt: true,
          updatedAt: true,
        },
      });

      await audit(request, {
        action: AUDIT_ACTION.SCHEDULED_REPORT_UPDATED,
        entityType: "ScheduledReport",
        entityId: scheduleId,
        meta: {
          savedReportId: reportId,
          changes: Object.keys(data),
        },
      });

      return ok({
        id: updated.id,
        cadence: updated.cadence,
        deliveryChannel: updated.deliveryChannel,
        deliveryTarget: updated.deliveryTarget,
        format: updated.format,
        enabled: updated.enabled,
        nextRunAt: updated.nextRunAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  const { reportId, scheduleId } = idsFromUrl(request);
  return runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    async () => {
      const existing = await prisma.scheduledReport.findFirst({
        where: { id: scheduleId, savedReportId: reportId },
        select: { id: true, cadence: true, deliveryChannel: true },
      });
      if (!existing) return notFound();
      await prisma.scheduledReport.delete({ where: { id: scheduleId } });
      await audit(request, {
        action: AUDIT_ACTION.SCHEDULED_REPORT_DELETED,
        entityType: "ScheduledReport",
        entityId: scheduleId,
        meta: {
          savedReportId: reportId,
          cadence: existing.cadence,
          deliveryChannel: existing.deliveryChannel,
        },
      });
      return ok({ id: scheduleId, deleted: true });
    },
  );
}
