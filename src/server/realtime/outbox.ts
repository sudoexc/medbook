/**
 * Outbox publisher — write-ahead-log for cross-surface events (TZ §5.3).
 *
 * `publishViaOutbox(tx, envelope)` inserts a row into `EventOutbox` inside an
 * existing Prisma transaction. The OutboxPumper worker picks the row up,
 * calls `publishEvent()` to fan out (local bus + Redis), and marks the row
 * `DELIVERED`. Auditable events become an `AuditLog` row with `eventId` as
 * the idempotency key so a re-delivery never duplicates audit entries.
 *
 * Why this layer instead of calling `publishEvent` directly:
 *
 *   1. **At-least-once.** The outbox insert is in the same transaction as the
 *      domain mutation. If the tx commits, the event will be delivered (the
 *      pumper retries). If the tx rolls back, the event vanishes — no
 *      ghost event for a write that didn't happen.
 *   2. **Replay.** `/api/events?since=<eventId>` can read `DELIVERED` rows
 *      out of the outbox to backfill a reconnecting SSE client.
 *   3. **Audit unification.** `AuditLog` rows for cross-surface events get
 *      materialised by the pumper from the envelope, not by every caller.
 */

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { prisma as prismaT } from "@/lib/prisma";
import { getMetrics } from "@/server/observability/metrics";

import type {
  EventEnvelope,
  EventEnvelopeInput,
} from "./envelope";
import { EventEnvelopeSchema } from "./envelope";

/**
 * Accept either the extended `prisma` singleton or the tx callback parameter
 * from `prisma.$transaction(async (tx) => …)`. The two differ structurally
 * because Prisma strips `$extends` / `$use` from the callback param — we
 * derive the callback shape via `Parameters<…>` so both are admissible.
 */
type PrismaTxCallbackArg = Parameters<
  Parameters<typeof prismaT["$transaction"]>[0]
>[0];
export type OutboxTx = PrismaTxCallbackArg | typeof prismaT;

export type PublishViaOutboxResult = {
  eventId: string;
  correlationId: string;
};

/**
 * Insert an outbox row inside the surrounding transaction.
 *
 *   await prisma.$transaction(async (tx) => {
 *     await tx.appointment.update({ … });
 *     await publishViaOutbox(tx, {
 *       correlationId,
 *       type: "appointment.statusChanged",
 *       actor:  { role: "RECEPTIONIST", userId, patientId: null, ... },
 *       surface: "CRM",
 *       tenantScope: { clinicId, appointmentId, doctorId, patientId },
 *       payload: { appointmentId, previousStatus: "BOOKED", status: "CONFIRMED" },
 *     });
 *   });
 *
 * Returns the generated `eventId` so the caller can chain follow-up events
 * via `causedByEventId`.
 */
export async function publishViaOutbox<P = unknown>(
  tx: OutboxTx,
  input: EventEnvelopeInput<P>,
): Promise<PublishViaOutboxResult> {
  const eventId = randomUUID();
  const at = new Date().toISOString();
  const envelope: EventEnvelope<P> = { ...input, eventId, at };

  const parsed = EventEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") ?? "(root)";
    throw new Error(
      `[outbox] invalid envelope for "${String(input.type)}" at ${path}: ${
        first?.message ?? "schema mismatch"
      }`,
    );
  }

  await (tx as typeof prismaT).eventOutbox.create({
    data: {
      id: eventId,
      correlationId: envelope.correlationId,
      causedByEventId: envelope.causedByEventId ?? null,
      clinicId: envelope.tenantScope.clinicId,
      type: envelope.type,
      envelope: envelope as unknown as Prisma.InputJsonValue,
    },
  });

  getMetrics().outboxPublishes.inc({
    event_type: envelope.type,
    surface: envelope.surface,
  });

  return { eventId, correlationId: envelope.correlationId };
}

/**
 * Convenience for the first event in a cascade — when no upstream
 * `correlationId` exists, mint a fresh one. Use this at API boundaries
 * (route handler, webhook); inside a cascade always inherit the upstream id.
 */
export function newCorrelationId(): string {
  return randomUUID();
}
