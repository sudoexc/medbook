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
import { compareQueue, serveAtMs } from "@/lib/queue-ordering";

/** Spacing between consecutive serveAt anchors when re-sequencing (1 s). */
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

    // Variant A — re-sequence by rewriting the serveAt anchor (`queuedAt`), not
    // `queueOrder`, which stays frozen as the immutable ticket-number source.
    // Anchor the new sequence at the earliest serveAt currently in the set and
    // space rows STEP_MS apart so the shared EDF comparator (`compareQueue`)
    // reproduces exactly this top-to-bottom order on every surface.
    //
    // Caveat: a booking whose slot is still in the future floors at its slot
    // (serveAt = max(slot, queuedAt)), so dragging it *earlier* than its slot is
    // a no-op — the receptionist uses «срочно» (queuePriority) to pull a
    // not-yet-due booking ahead. Walk-ins and already-due bookings move freely.
    const base = Math.min(...existing.map((a) => serveAtMs(a)));
    const byId = new Map(existing.map((a) => [a.id, a]));

    // Project the post-write rows (new `queuedAt` anchors) and recompute the
    // order the shared comparator will actually render on the board. A booking
    // whose slot is still in the future floors at its slot
    // (serveAt = max(slot, queuedAt)), so dragging it earlier than its slot is a
    // no-op. We surface those ids (`floored`) and the resulting order
    // (`effectiveOrder`) so the reception UI can correct its optimistic state
    // and nudge the operator toward «срочно» (queuePriority) instead of lying
    // with a bare success.
    const projected = uniqueIds.map((id, idx) => {
      const row = byId.get(id)!;
      return { ...row, queuedAt: new Date(base + idx * STEP_MS) };
    });
    const floored = projected
      .filter(
        (r) => r.channel !== "WALKIN" && r.date.getTime() > r.queuedAt.getTime(),
      )
      .map((r) => r.id);
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

    return ok({ count: uniqueIds.length, exact, floored, effectiveOrder });
  },
);
