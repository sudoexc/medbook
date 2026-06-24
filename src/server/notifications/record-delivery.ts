/**
 * Single entry point for "this NotificationSend just hit a terminal state".
 *
 * Cross-surface sync §7.8 — replaces the worker's `update + publishEventSafe`
 * pair (which split the row write and the cross-surface signal across two
 * round-trips). The kernel collapses both into one transaction:
 *
 *   1. Flip the row to its terminal status (SENT / DELIVERED / FAILED) and
 *      stamp the corresponding timestamps + externalId + retryCount delta.
 *   2. Emit the matching envelope (`notification.sent` for SENT/DELIVERED,
 *      `notification.failed` for the terminal failure) via the outbox so the
 *      pumper materialises an AuditLog row (failure only — `notification.failed`
 *      is auditable:warning, `notification.sent` is high-frequency noise and
 *      stays un-audited).
 *
 * Caller still owns the bare row writes for non-terminal states:
 *   • retry-pending (status stays QUEUED, failedReason + retryCount bumped),
 *   • pre-deliver cancel ("patient already confirmed", status → CANCELLED).
 * These don't produce a cross-surface event, so they bypass the kernel.
 *
 * Surface defaults to WORKER; actor defaults to SYSTEM. The webhook variant
 * (DLR-style provider callbacks landing on the worker) can override surface
 * to TG_WEBHOOK and pass through the upstream correlationId. (SMS_WEBHOOK
 * is legacy — SMS removed in `docs/TZ-sms-removal.md`.)
 */

import { prisma } from "@/lib/prisma";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type {
  ActorRole,
  EventEnvelopeInput,
  Surface,
} from "@/server/realtime/envelope";

export type NotificationChannel = "TG" | "INAPP" | "EMAIL" | "CALL" | "VISIT";

/** Fields the kernel reads off the loaded `NotificationSend` row. */
export type NotificationSendRef = {
  id: string;
  clinicId: string;
  patientId: string | null;
  channel: NotificationChannel;
  /** `template.key` when populated; else the raw `templateId` for trace. */
  templateKey: string | null;
  /** Broadcast campaign this send belongs to (null for transactional sends). */
  campaignId: string | null;
};

export type RecordDeliveryOutcome =
  | {
      kind: "sent";
      /** Provider-side id (TG message id). */
      externalId: string;
      sentAt: Date;
    }
  | {
      kind: "delivered";
      /** Provider-side id (INAPP: inbox row id). */
      externalId: string;
      sentAt: Date;
      deliveredAt: Date;
    }
  | {
      kind: "failed";
      failedReason: string;
      /** Final retry count to stamp on the row. */
      retryCount: number;
    };

export type RecordNotificationDeliveryInput = {
  send: NotificationSendRef;
  outcome: RecordDeliveryOutcome;
  surface?: Surface;
  actorRole?: ActorRole;
  actorLabel?: string;
  correlationId?: string;
  causedByEventId?: string;
};

export type RecordNotificationDeliveryResult = {
  eventId: string;
  correlationId: string;
};

export async function recordNotificationDelivery(
  input: RecordNotificationDeliveryInput,
): Promise<RecordNotificationDeliveryResult> {
  const surface: Surface = input.surface ?? "WORKER";
  const actorRole: ActorRole = input.actorRole ?? "SYSTEM";
  const actorLabel =
    input.actorLabel ?? `notifications-send:${input.send.channel.toLowerCase()}`;
  const correlationId = input.correlationId ?? newCorrelationId();

  return prisma.$transaction(async (tx) => {
    if (input.outcome.kind === "sent") {
      await tx.notificationSend.update({
        where: { id: input.send.id },
        data: {
          status: "SENT",
          sentAt: input.outcome.sentAt,
          externalId: input.outcome.externalId,
          retryCount: { increment: 1 },
        },
      });
    } else if (input.outcome.kind === "delivered") {
      await tx.notificationSend.update({
        where: { id: input.send.id },
        data: {
          status: "DELIVERED",
          sentAt: input.outcome.sentAt,
          deliveredAt: input.outcome.deliveredAt,
          externalId: input.outcome.externalId,
          retryCount: { increment: 1 },
        },
      });
    } else {
      await tx.notificationSend.update({
        where: { id: input.send.id },
        data: {
          status: "FAILED",
          failedReason: input.outcome.failedReason.slice(0, 500),
          retryCount: input.outcome.retryCount,
        },
      });
    }

    const eventType =
      input.outcome.kind === "failed"
        ? "notification.failed"
        : "notification.sent";
    const payload = {
      sendId: input.send.id,
      channel: input.send.channel,
      patientId: input.send.patientId,
      templateKey: input.send.templateKey ?? undefined,
      ...(input.outcome.kind === "failed"
        ? { failedReason: input.outcome.failedReason.slice(0, 200) }
        : {}),
    };

    const envelope: EventEnvelopeInput = {
      correlationId,
      causedByEventId: input.causedByEventId,
      actor: {
        role: actorRole,
        userId: null,
        patientId: null,
        onBehalfOfPatientId: null,
        label: actorLabel,
      },
      surface,
      tenantScope: {
        clinicId: input.send.clinicId,
        patientId: input.send.patientId ?? undefined,
      },
      type: eventType,
      payload,
    };
    const published = await publishViaOutbox(tx, envelope);

    // Broadcast rollup: this send just reached a terminal state, so recompute
    // the parent campaign's progress and finalize it once nothing is left
    // QUEUED. Counters are recomputed absolutely (not incremented) from the
    // send rows — idempotent under retries and self-healing if two concurrent
    // deliveries finalize the same campaign. The SENDING status guard keeps a
    // CANCELLED/already-DONE campaign from being clobbered or resurrected.
    if (input.send.campaignId) {
      const grouped = await tx.notificationSend.groupBy({
        by: ["status"],
        where: {
          campaignId: input.send.campaignId,
          clinicId: input.send.clinicId,
        },
        _count: { _all: true },
      });
      let sent = 0;
      let failed = 0;
      let pending = 0;
      for (const g of grouped) {
        const n = g._count._all;
        if (g.status === "SENT" || g.status === "DELIVERED" || g.status === "READ") {
          sent += n;
        } else if (g.status === "FAILED") {
          failed += n;
        } else if (g.status === "QUEUED") {
          pending += n;
        }
      }
      await tx.campaign.updateMany({
        where: { id: input.send.campaignId, status: "SENDING" },
        data:
          pending === 0
            ? {
                status: "DONE",
                finishedAt: new Date(),
                sentCount: sent,
                failedCount: failed,
              }
            : { sentCount: sent, failedCount: failed },
      });
    }

    return published;
  });
}
