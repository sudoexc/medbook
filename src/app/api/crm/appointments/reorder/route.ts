/**
 * POST /api/crm/appointments/reorder
 *
 * Re-sequence the live queue for a single doctor today. Used by the reception
 * doctor-queue panel: receptionist drags a patient up/down and we persist the
 * new order so kiosk/TV board reflect the same sequence (ticket numbers are
 * derived from `queueOrder` via `ticketNumberFor`).
 *
 * Body: `{ doctorId, orderedIds: string[] }` — `orderedIds` is the desired
 * sequence from top to bottom. We trust the client to pass *every* active
 * row for that doctor today; any id outside the set is left alone.
 *
 * Auth: ADMIN + RECEPTIONIST. DOCTORs can't shuffle other doctors' queues —
 * deliberately tight since this op shifts ticket numbers on the public board.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { publishEventSafe } from "@/server/realtime/publish";
import { getTenant } from "@/lib/tenant-context";
import { ReorderQueueSchema } from "@/server/schemas/appointment";
import { compareQueue, isLiveLane, queuedMs } from "@/lib/queue-ordering";

/** Spacing between consecutive FIFO anchors when re-sequencing (1 s). */
const STEP_MS = 1000;

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST"],
    bodySchema: ReorderQueueSchema,
  },
  async ({ request, body }) => {
    const { doctorId, orderedIds } = body;

    // De-dupe and validate that ids belong to this doctor (tenant scope is
    // enforced by the Prisma extension). Anything missing → 422 so the
    // client can refetch and retry against fresh data.
    const uniqueIds = Array.from(new Set(orderedIds));
    if (uniqueIds.length !== orderedIds.length) {
      return err("DuplicateIds", 422, { reason: "duplicate_ids" });
    }

    const existing = await prisma.appointment.findMany({
      where: { id: { in: uniqueIds }, doctorId },
      select: {
        id: true,
        date: true,
        queuedAt: true,
        channel: true,
        queuePriority: true,
        ticketSeq: true,
      },
    });
    if (existing.length !== uniqueIds.length) {
      const found = new Set(existing.map((a) => a.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      return err("IdsMismatch", 422, { reason: "ids_mismatch", missing });
    }

    // Two-lanes: only LIVE-lane rows (walk-ins) have a queue order to shuffle.
    // Bookings live on the schedule axis and never interleave (TZ-two-lanes I2)
    // — a set containing one is a stale client; 422 so it refetches lanes.
    const bookings = existing.filter((a) => !isLiveLane(a));
    if (bookings.length > 0) {
      return err("NotLiveLane", 422, {
        reason: "not_live_lane",
        ids: bookings.map((a) => a.id),
      });
    }

    // Variant A — re-sequence by rewriting the FIFO anchor (`queuedAt`), not
    // `queueOrder`, which stays frozen as the immutable ticket-number source.
    // Anchor the new sequence at the earliest arrival currently in the set and
    // space rows STEP_MS apart so the shared FIFO comparator (`compareQueue`)
    // reproduces exactly this top-to-bottom order on every surface. With the
    // schedule lane excluded above there is nothing left to "floor" — the
    // requested order is always the effective order.
    const base = Math.min(...existing.map((a) => queuedMs(a)));
    const byId = new Map(existing.map((a) => [a.id, a]));

    const projected = uniqueIds.map((id, idx) => {
      const row = byId.get(id)!;
      return { ...row, queuedAt: new Date(base + idx * STEP_MS) };
    });
    const effectiveOrder = [...projected].sort(compareQueue).map((r) => r.id);
    const exact =
      effectiveOrder.length === uniqueIds.length &&
      effectiveOrder.every((id, i) => id === uniqueIds[i]);

    await prisma.$transaction(
      uniqueIds.map((id, idx) =>
        prisma.appointment.update({
          where: { id },
          data: { queuedAt: new Date(base + idx * STEP_MS) },
        }),
      ),
    );

    await audit(request, {
      action: "appointment.queue-reorder",
      entityType: "Appointment",
      meta: { doctorId, orderedIds: uniqueIds },
    });

    const tenant = getTenant();
    const clinicId = tenant?.kind === "TENANT" ? tenant.clinicId : null;
    if (clinicId) {
      publishEventSafe(clinicId, {
        type: "queue.updated",
        payload: { doctorId, reorder: true, count: uniqueIds.length },
      });
    }

    return ok({ count: uniqueIds.length, exact, effectiveOrder });
  },
);
