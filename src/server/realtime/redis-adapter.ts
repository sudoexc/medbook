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
/** The last psubscribe attempt failed and none has succeeded since. */
let subscribeFailing = false;
let subscribeRetry: ReturnType<typeof setTimeout> | null = null;
const SUBSCRIBE_RETRY_MIN_MS = 1_000;
const SUBSCRIBE_RETRY_MAX_MS = 30_000;
let subscribeRetryMs = SUBSCRIBE_RETRY_MIN_MS;

/**
 * Thrown by `publishEnvelopeToRedis` when Redis refused the PUBLISH. The
 * outbox pumper runs in the worker, where no SSE client listens: Redis is
 * the only way its events reach the screens, so a failed publish is a failed
 * delivery and the row must be retried, not marked DELIVERED (audit INF-17).
 */
export class RedisPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisPublishError";
  }
}

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
  // `started` guards the pmessage handler (attached once); the subscription
  // itself is retried below until Redis acknowledges it.
  started = true;
  subscribeWithRetry(sub);

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
 * psubscribe with a doubling retry (1 s up to 30 s). A first psubscribe that
 * failed (Redis down while the app started) used to be logged and forgotten:
 * ioredis only re-subscribes channels it once had, so worker events never
 * reached any screen until the app was restarted (audit INF-17). Once
 * acknowledged, ioredis' autoResubscribe covers later reconnects.
 */
function subscribeWithRetry(sub: RedisClient): void {
  sub
    .psubscribe("events:*")
    .then(() => {
      subscribeFailing = false;
      subscribeRetryMs = SUBSCRIBE_RETRY_MIN_MS;
    })
    .catch((err) => {
      subscribeFailing = true;
      const delay = subscribeRetryMs;
      subscribeRetryMs = Math.min(subscribeRetryMs * 2, SUBSCRIBE_RETRY_MAX_MS);
      console.warn(
        `[realtime:redis:sub] psubscribe failed, retrying in ${delay / 1000}s`,
        err?.message ?? err,
      );
      subscribeRetry = setTimeout(() => {
        subscribeRetry = null;
        if (started && subscriber === sub) subscribeWithRetry(sub);
      }, delay);
      subscribeRetry.unref?.();
    });
}

/**
 * False only when this process tried to subscribe to the realtime channel
 * and has not managed to yet: live events from the worker are not reaching
 * its SSE clients. True when the subscriber was never needed (no SSE client
 * connected yet, or no Redis), so a fresh process does not look broken.
 */
export function isRedisSubscriptionHealthy(): boolean {
  return !subscribeFailing;
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
 *
 * Returns `false` when Redis is disabled, `true` once published. A failed
 * PUBLISH throws `RedisPublishError` (it used to be swallowed with `true`,
 * and the pumper marked the row DELIVERED although no screen got it).
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
    throw new RedisPublishError(`envelope publish failed: ${msg}`);
  }
  return true;
}

/** Testing hook — close connections so vitest doesn't hang. */
export async function __resetRedisForTests(): Promise<void> {
  started = false;
  subscribeFailing = false;
  subscribeRetryMs = SUBSCRIBE_RETRY_MIN_MS;
  if (subscribeRetry) clearTimeout(subscribeRetry);
  subscribeRetry = null;
  await Promise.all([
    publisher ? publisher.quit().catch(() => {}) : Promise.resolve(),
    subscriber ? subscriber.quit().catch(() => {}) : Promise.resolve(),
  ]);
  publisher = null;
  subscriber = null;
}
