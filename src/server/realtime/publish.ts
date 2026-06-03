/**
 * `publishEvent(clinicId, event)` — the canonical way to emit a realtime
 * event.
 *
 *   - Validates through the Zod discriminated union (`AppEventSchema`) so a
 *     malformed payload fails at the call-site instead of on the wire.
 *   - Pushes to the in-process `EventBus` on channel `clinic:<id>:events`
 *     so local SSE subscribers receive the event immediately.
 *   - When `REDIS_URL` is set, also mirrors to Redis (`events:<clinicId>`)
 *     for horizontal fan-out. Other Node processes hear it via
 *     `ensureRedisSubscriber()`.
 *
 * Call shape:
 *
 *   publishEvent(clinicId, {
 *     type: "appointment.created",
 *     payload: { appointmentId, doctorId, ... },
 *   });
 *
 * The envelope's `at` defaults to now; pass it only when replaying events
 * from storage. `clinicId` in the first argument always wins over any
 * caller-supplied value.
 */

import { getEventBus } from "./event-bus";
import { clinicChannel } from "./channels";
import type { EventEnvelope } from "./envelope";
import {
  AppEventSchema,
  type AppEvent,
  type AppEventInput,
} from "./events";
import {
  publishToRedis,
  publishEnvelopeToRedis,
  isRedisEnabled,
} from "./redis-adapter";

export type PublishOutcome = {
  /** Validated envelope (useful for logging). */
  event: AppEvent;
  /** `true` iff the local in-process bus dispatched synchronously. */
  local: boolean;
  /** `true` iff Redis fan-out was attempted (only when REDIS_URL set). */
  redis: boolean;
};

/**
 * Synchronously validate + fan out. Returns a promise because Redis publish
 * is async; the local bus is invoked synchronously so tests can observe the
 * dispatch without awaiting.
 */
export async function publishEvent(
  clinicId: string,
  input: AppEventInput,
): Promise<PublishOutcome> {
  const envelope: unknown = {
    type: input.type,
    clinicId,
    at: input.at ?? new Date().toISOString(),
    payload: input.payload,
  };

  const parsed = AppEventSchema.safeParse(envelope);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") ?? "(root)";
    throw new Error(
      `[realtime] invalid event "${String(input.type)}" at ${path}: ${
        first?.message ?? "schema mismatch"
      }`,
    );
  }
  const event = parsed.data;

  // Local dispatch first — zero dependency, always succeeds.
  getEventBus().publish(clinicChannel(event.clinicId), event);

  // Redis mirror (best-effort, never throws).
  const redis = isRedisEnabled();
  if (redis) {
    await publishToRedis(event);
  }

  return { event, local: true, redis };
}

/**
 * Fire-and-forget variant for call-sites that don't want to `await`. Errors
 * are swallowed with a `console.warn` so a malformed publish never breaks
 * the enclosing mutation handler.
 */
export function publishEventSafe(
  clinicId: string,
  input: AppEventInput,
): void {
  publishEvent(clinicId, input).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[realtime] publishEvent failed: ${msg}`);
  });
}

/**
 * Cross-surface sync Phase A.7 — broadcast a pre-validated v2 envelope.
 *
 * Used by `OutboxPumper`: the envelope was already validated when the
 * outbox row was inserted via `publishViaOutbox`, so we skip re-validation
 * and dispatch directly onto the bus. SSE handlers see the full v2
 * envelope (eventId, correlationId, actor, surface, tenantScope) so they
 * can emit `id: <eventId>` lines for `Last-Event-ID` reconnects.
 *
 * Returns whether Redis fan-out was attempted (same contract as
 * `publishEvent`).
 */
export async function broadcastEnvelope(
  envelope: EventEnvelope,
): Promise<{ local: boolean; redis: boolean }> {
  const clinicId = envelope.tenantScope.clinicId;
  getEventBus().publish(clinicChannel(clinicId), envelope);

  const redis = isRedisEnabled();
  if (redis) {
    await publishEnvelopeToRedis(envelope);
  }
  return { local: true, redis };
}
