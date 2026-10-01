/**
 * /api/crm/settings/notifications/templates — list templates per clinic for the
 * settings editor (Phase 8b/c).
 *
 * GET only here. Updates go to /api/crm/settings/notifications/templates/[id].
 *
 * Per-clinic scoping is enforced by the tenant-scope Prisma extension (the
 * createApiListHandler wraps the inner handler in `runWithTenant`).
 *
 * The «исправление в заключении» message (audit G3-03) is provisioned here,
 * switched off, so the admin finds it in the list and decides when patients
 * start getting it; otherwise its row would appear only after the first
 * amendment. The same for «запись восстановлена» (audit AP-11), sent when
 * a doctor undoes a cancellation or a no-show.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { ensureAmendmentNoticeTemplate } from "@/server/visit-notes/amendment-notice";
import { ensureAppointmentRestoredTemplate } from "@/server/notifications/triggers";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    // A view-only impersonation reads, never writes.
    if (ctx.kind === "TENANT" && ctx.impersonation?.mode !== "VIEW_ONLY") {
      try {
        await ensureAmendmentNoticeTemplate(ctx.clinicId);
      } catch (e) {
        // A provisioning hiccup must not hide the clinic's templates.
        console.error("[settings/notifications] amendment template", e);
      }
      try {
        await ensureAppointmentRestoredTemplate(ctx.clinicId);
      } catch (e) {
        console.error("[settings/notifications] restored template", e);
      }
    }
    const rows = await prisma.notificationTemplate.findMany({
      orderBy: [{ category: "asc" }, { trigger: "asc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        nameRu: true,
        nameUz: true,
        channel: true,
        category: true,
        trigger: true,
        triggerConfig: true,
        bodyRu: true,
        bodyUz: true,
        isActive: true,
        updatedAt: true,
      },
    });
    return ok({ rows });
  },
);
