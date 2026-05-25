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
      select: { id: true, queueOrder: true },
    });
    if (existing.length !== uniqueIds.length) {
      const found = new Set(existing.map((a) => a.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      return err("IdsMismatch", 422, { reason: "ids_mismatch", missing });
    }

    // One transaction, sequential 1..N updates. With ≤200 rows this is
    // well under a millisecond per row; no need to drop to raw SQL.
    await prisma.$transaction(
      uniqueIds.map((id, idx) =>
        prisma.appointment.update({
          where: { id },
          data: { queueOrder: idx + 1 },
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

    return ok({ count: uniqueIds.length });
  },
);
