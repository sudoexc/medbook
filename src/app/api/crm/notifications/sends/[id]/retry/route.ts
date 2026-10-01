/**
 * /api/crm/notifications/sends/[id]/retry — requeue a failed send.
 * See docs/TZ.md §6.4.
 *
 * Audit TG-08: only a FAILED row, or one abandoned mid-send (SENDING past
 * the stale timeout), may be retried; anything else answers 409. Retrying a
 * SENT row used to deliver the same message to the patient again.
 *
 * The row is due again now with a fresh attempt budget. Moving
 * `scheduledFor` used to trip the send worker's stale-time guard, so every
 * retried appointment reminder ended «Отменено» seconds after the
 * «Поставлено в очередь» toast; the guard now compares the appointment's
 * start with `appointmentAt`, pinned here for rows that predate it.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, ok, notFound } from "@/server/http";
import { isRetryable, pinnedAnchor } from "@/server/notifications/delivery-state";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../sends/[id]/retry
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.notificationSend.findUnique({
      where: { id },
      include: { template: { select: { trigger: true, triggerConfig: true } } },
    });
    if (!before) return notFound();
    const now = new Date();
    if (!isRetryable(before, now)) {
      return err("notification.retry.not_retryable", 409);
    }
    // Conditional on the state just checked: a worker that finishes the
    // abandoned send, or a second click, makes this a no-op.
    const res = await prisma.notificationSend.updateMany({
      where: { id, status: before.status, claimedAt: before.claimedAt },
      data: {
        status: "QUEUED",
        failedReason: null,
        failedAt: null,
        claimedAt: null,
        // A staff retry starts a fresh budget of attempts with backoff.
        retryCount: 0,
        scheduledFor: now,
        ...pinnedAnchor(before),
      },
    });
    if (res.count !== 1) {
      return err("notification.retry.not_retryable", 409);
    }
    const after = await prisma.notificationSend.findUnique({ where: { id } });
    await audit(request, {
      action: "send.retry",
      entityType: "NotificationSend",
      entityId: id,
      meta: {
        before: before.status,
        after: after?.status ?? "QUEUED",
        failedReason: before.failedReason,
        attempts: before.retryCount,
      },
    });
    return ok(after);
  }
);
