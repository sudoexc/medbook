/**
 * /api/crm/appointments/bulk-status — change status for many at once.
 * See docs/TZ.md §6.2 bulk actions.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, conflict, err } from "@/server/http";
import { BulkStatusSchema } from "@/server/schemas/appointment";
import {
  canTransitionAt,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";
import {
  canRoleAdvanceTo,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import { fireTrigger } from "@/server/notifications/triggers";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: BulkStatusSchema,
  },
  async ({ request, body, ctx }) => {
    const now = new Date();
    const target = body.status as AppointmentStatus;

    // Role-ownership: the role granted at handler level (ADMIN /
    // RECEPTIONIST) is reception — neither owns IN_PROGRESS / COMPLETED. We
    // refuse the whole batch up-front rather than per-row so the operator
    // sees one clean error rather than a half-applied bulk write.
    if (ctx.kind === "TENANT") {
      const role = ctx.role as LifecycleRole;
      if (!canRoleAdvanceTo(role, target)) {
        return err("Forbidden", 403, {
          reason: "role_cannot_advance_to",
          target,
          role,
        });
      }
    }

    // Pre-flight: refuse the whole batch if any selected row can't reach the
    // target status. The UI should already prevent this, but the server is
    // the source of truth — kiosks, scripts, or stale tabs may still try.
    const existing = await prisma.appointment.findMany({
      where: { id: { in: body.ids } },
      select: { id: true, status: true, date: true },
    });
    const blocked = existing
      .map((a) => ({
        a,
        check: canTransitionAt(
          a.status as AppointmentStatus,
          target,
          a.date,
          now,
        ),
      }))
      .filter((x) => !x.check.ok);
    if (blocked.length > 0) {
      const reason = blocked[0]?.check.ok === false ? blocked[0].check.reason : "invalid_transition";
      return conflict(reason, {
        to: target,
        blocked: blocked.map((x) => ({ id: x.a.id, from: x.a.status })),
      });
    }

    const data: Record<string, unknown> = { status: target };
    if (target === "CANCELLED") {
      data.cancelledAt = now;
      if (body.cancelReason) data.cancelReason = body.cancelReason;
    }
    if (target === "COMPLETED") data.completedAt = now;

    const result = await prisma.appointment.updateMany({
      where: { id: { in: body.ids } },
      data,
    });
    await audit(request, {
      action: "appointment.bulk-status",
      entityType: "Appointment",
      meta: { ids: body.ids, status: target, count: result.count },
    });

    // TZ-notifications-cancel-sync §8.4 — manual NO_SHOW bulk action mirrors
    // the auto-sweep path. Each just-flipped row gets a "sorry it didn't
    // work out, want to reschedule?" text. Dedup with the auto-sweep is
    // automatic via the NotificationSend unique key on (appointment,
    // template). Fire-and-forget — text delivery cost shouldn't block the
    // operator's bulk action response.
    if (target === "NO_SHOW") {
      for (const id of body.ids) {
        fireTrigger({ kind: "appointment.no-show", appointmentId: id });
      }
    }

    return ok({ count: result.count });
  }
);
