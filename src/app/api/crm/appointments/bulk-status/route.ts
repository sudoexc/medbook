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
import { emitAppointmentChangeViaOutbox } from "@/server/appointments/emit-change";
import { newCorrelationId } from "@/server/realtime/outbox";
import { applyWaitingIntake, type PrismaTx } from "@/server/appointments/intake";
import { allocateQueueOrder } from "@/server/appointments/queue-order";
import { runQueueTx } from "@/server/appointments/queue-order";

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
      select: {
        id: true,
        status: true,
        queueStatus: true,
        doctorId: true,
        patientId: true,
        cabinetId: true,
        date: true,
        // Intake inputs for the WAITING target (see applyWaitingIntake).
        clinicId: true,
        queueOrder: true,
        queuedAt: true,
      },
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
    // Mirror status→queueStatus so the reception board's «Кабинеты и врачи»
    // lane tracks the flip. The single-appointment PATCH already does this;
    // this bulk path historically wrote only `status`, leaving the queue stale.
    data.queueStatus = target;
    if (target === "CANCELLED") {
      data.cancelledAt = now;
      if (body.cancelReason) data.cancelReason = body.cancelReason;
    }
    if (target === "COMPLETED") data.completedAt = now;

    const correlationId = newCorrelationId();
    // WAITING is the one target with per-row side-effects — each row claims
    // its own queueOrder/ticketSeq + queuedAt stamp (see applyWaitingIntake),
    // which updateMany can't express. That branch loops row-by-row and runs
    // under Serializable via runQueueTx (same isolation as the single
    // queue-status intake, so a concurrent kiosk check-in can't share an
    // order). Every other target keeps the original updateMany + default
    // isolation — no behavioral change there.
    const txBody = async (tx: PrismaTx) => {
      let count: number;
      if (target === "WAITING") {
        count = 0;
        // One order aggregate per doctor, not per row: rows needing a number
        // get base, base+1, … from a single allocation, so a 500-row bulk
        // does D queries (distinct doctors) instead of N inside the
        // Serializable tx — shrinking the write-conflict window runQueueTx
        // retries on.
        const nextOrderByDoctor = new Map<string, number>();
        for (const row of existing) {
          let presetOrder: number | undefined;
          if (row.queueOrder == null) {
            let next = nextOrderByDoctor.get(row.doctorId);
            if (next === undefined) {
              next = await allocateQueueOrder(tx, {
                clinicId: row.clinicId,
                doctorId: row.doctorId,
                at: now,
              });
            }
            presetOrder = next;
            nextOrderByDoctor.set(row.doctorId, next + 1);
          }
          const intake = await applyWaitingIntake(tx, row, now, { presetOrder });
          await tx.appointment.update({
            where: { id: row.id },
            data: { ...data, ...intake } as never,
          });
          count += 1;
        }
      } else {
        const updated = await tx.appointment.updateMany({
          where: { id: { in: body.ids } },
          data,
        });
        count = updated.count;
      }
      // Realtime fan-out per row so reception, doctor my-day, and the public TV
      // board see the flip without polling. Same routing as the single PATCH:
      // CANCELLED → appointment.cancelled, any other flip →
      // appointment.statusChanged, plus a queue.updated follow-up (the queue
      // lane always shifts on a status change). The appointment write and the
      // outbox rows commit together inside this transaction.
      if (ctx.kind === "TENANT") {
        const kind = target === "CANCELLED" ? "cancelled" : "statusChanged";
        const actorRole = ctx.role === "ADMIN" ? "ADMIN" : "RECEPTIONIST";
        const actorUserId = ctx.userId || null;
        for (const before of existing) {
          await emitAppointmentChangeViaOutbox({
            tx,
            kind,
            before,
            after: { ...before, status: target, queueStatus: target },
            clinicId: ctx.clinicId,
            actorId: actorUserId,
            actorRole,
            actorLabel: actorUserId ? `user:${actorUserId}` : "user:anonymous",
            surface: "CRM",
            correlationId,
            alsoQueueUpdate: true,
          });
        }
      }
      return { count };
    };
    const result =
      target === "WAITING"
        ? await runQueueTx(txBody)
        : await prisma.$transaction(txBody);
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
