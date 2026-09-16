/**
 * Redis pub/sub adapter (lazy).
 *
 * Activated only when `process.env.REDIS_URL` is set. Two clients are kept:
 *
 *   - `publisher` — used by `publishEvent()` to mirror validated events to
 *     `events:<clinicId>`.
 *   - `subscriber` — subscribes to `events:*` (pSubscribe) and forwards
 *     messages back into the local EventBus so downstream SSE subscribers
 *     receive events originating on another node.
 *
 * Both clients are created on first use. Import this module sparingly — it
 * pulls `ioredis`.
 *
 * Note: channel topology is `events:<clinicId>` so fan-out is O(subs per
 * clinic) rather than O(subs globally). The SSE endpoint subscribes to a
 * *single* clinic channel via the local bus, not directly via Redis.
 */

import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";

import { getEventBus } from "./event-bus";
import { clinicChannel, type AppEvent } from "./channels";
import type { EventEnvelope } from "./envelope";

let publisher: RedisClient | null = null;
let subscriber: RedisClient | null = null;
import { randomUUID } from "node:crypto";

/**
 * Identifies THIS process's publishes on the Redis channel.
 *
 * Publish and subscribe run in the same process (every SSE route calls
 * `ensureRedisSubscriber()`), so without a marker each locally-published
 * event came straight back off Redis and hit the local bus a second time.
 * v2 envelopes deduped by eventId downstream; v1 events have no id, so the
 * echo reached clients: the TV chimed twice per call and every CRM surface
 * ran a double invalidation per event («уведы глючат»). The subscriber drops
 * frames carrying our own origin.
 */
const ORIGIN_ID = randomUUID();

type WireFrame = { __origin: string; payload: unknown };

function isWireFrame(v: unknown): v is WireFrame {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as WireFrame).__origin === "string" &&
    "payload" in (v as WireFrame)
  );
}

let started = false;

export function isRedisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

function getPublisher(): RedisClient | null {
  if (!isRedisEnabled()) return null;
  if (publisher) return publisher;
  publisher = new Redis(process.env.REDIS_URL!, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
  });
  publisher.on("error", (err) => {
    console.warn("[realtime:redis:pub] error", err?.message ?? err);
  });
  return publisher;
}

function getSubscriber(): RedisClient | null {
  if (!isRedisEnabled()) return null;
  if (subscriber) return subscriber;
  subscriber = new Redis(process.env.REDIS_URL!, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
  });
  subscriber.on("error", (err) => {
    console.warn("[realtime:redis:sub] error", err?.message ?? err);
  });
  return subscriber;
}

/**
 * Start the inbound subscriber once per process. Forwards every incoming
 * message on `events:*` to the in-process bus, tagging the local channel
 * as `clinicChannel(clinicId)`. Safe to call repeatedly — idempotent.
 */
export function ensureRedisSubscriber(): void {
  if (started) return;
  const sub = getSubscriber();
  if (!sub) return;
  started = true;

  sub.psubscribe("events:*").catch((err) => {
    console.warn("[realtime:redis:sub] psubscribe failed", err?.message ?? err);
  });

  sub.on("pmessage", (_pattern, channel: string, message: string) => {
    // channel shape: events:<clinicId>
    const idx = channel.indexOf(":");
    if (idx < 0) return;
    const clinicId = channel.slice(idx + 1);
    if (!clinicId) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    // Origin-framed messages: drop our own echo (already dispatched locally
    // at publish time), unwrap everyone else's. Bare frames are from an older
    // build mid-deploy — forward untouched.
    if (isWireFrame(parsed)) {
      if (parsed.__origin === ORIGIN_ID) return;
      parsed = parsed.payload;
    }
    // Forward to local bus. The SSE handler already listens on
    // `clinicChannel(clinicId)` so this lights it up.
    getEventBus().publish(clinicChannel(clinicId), parsed);
  });
}

/**
 * PUBLISH one event to Redis. No-op when `REDIS_URL` is not set.
 * Returns `false` when Redis is disabled, `true` otherwise (the Redis
 * promise errors are swallowed to avoid taking down request handlers).
 */
export async function publishToRedis(event: AppEvent): Promise<boolean> {
  const pub = getPublisher();
  if (!pub) return false;
  try {
    await pub.publish(
      `events:${event.clinicId}`,
      JSON.stringify({ __origin: ORIGIN_ID, payload: event } satisfies WireFrame),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[realtime:redis:pub] publish failed", msg);
  }
  return true;
}

/**
 * Cross-surface sync Phase A.7 — fan out a v2 envelope to Redis. The
 * subscriber on the other side parses and re-emits on the same channel as
 * a v1 publish, so the SSE handler sees both shapes interchangeably.
 */
export async function publishEnvelopeToRedis(
  envelope: EventEnvelope,
): Promise<boolean> {
  const pub = getPublisher();
  if (!pub) return false;
  try {
    await pub.publish(
      `events:${envelope.tenantScope.clinicId}`,
      JSON.stringify({
        __origin: ORIGIN_ID,
        payload: envelope,
      } satisfies WireFrame),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[realtime:redis:pub] envelope publish failed", msg);
  }
  return true;
}

/** Testing hook — close connections so vitest doesn't hang. */
export async function __resetRedisForTests(): Promise<void> {
  started = false;
  await Promise.all([
    publisher ? publisher.quit().catch(() => {}) : Promise.resolve(),
    subscriber ? subscriber.quit().catch(() => {}) : Promise.resolve(),
  ]);
  publisher = null;
  subscriber = null;
}
