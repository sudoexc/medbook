/**
 * POST /api/miniapp/inbox/[id]?clinicSlug=… — mark INAPP item as read.
 *
 * Sets `readAt = now()` and flips status to READ. Idempotent — re-marking a
 * row that's already READ is a no-op write.
 *
 * The `id` must belong to the authenticated patient inside the resolved
 * clinic; otherwise we return 404 (not 403, to avoid leaking row existence).
 *
 * Phase M2 — publishes `notification.read` through the outbox so the CRM
 * inbox badge can decrement live. The envelope is un-audited (default
 * severity, `auditable: false`) because it's a high-frequency UI toggle, not
 * a security-relevant fact.
 */
import { err, ok } from "@/server/http";
import { prisma } from "@/lib/prisma";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

export const POST = createMiniAppHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1] ?? "";
  if (!id) return err("bad_id", 400);

  const row = await prisma.notificationSend.findFirst({
    where: {
      id,
      patientId: ctx.patientId,
      clinicId: ctx.clinicId,
      channel: "INAPP",
    },
    select: { id: true, readAt: true },
  });
  if (!row) return err("not_found", 404);
  if (row.readAt) return ok({ id: row.id, readAt: row.readAt.toISOString() });

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.notificationSend.update({
      where: { id: row.id },
      data: { readAt: now, status: "READ" },
      select: { id: true, readAt: true },
    });
    const envelope: EventEnvelopeInput = {
      correlationId: newCorrelationId(),
      actor: {
        role: "PATIENT",
        userId: null,
        patientId: ctx.patientId,
        onBehalfOfPatientId: null,
        label: `patient:${ctx.patientId}`,
      },
      surface: "MINIAPP",
      tenantScope: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
      },
      type: "notification.read",
      payload: {
        sendId: next.id,
        patientId: ctx.patientId,
      },
    };
    await publishViaOutbox(tx, envelope);
    return next;
  });
  return ok({
    id: updated.id,
    readAt: updated.readAt ? updated.readAt.toISOString() : null,
  });
});
