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

let publisher: RedisClient | null = null;
let subscriber: RedisClient | null = null;
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
    await pub.publish(`events:${event.clinicId}`, JSON.stringify(event));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[realtime:redis:pub] publish failed", msg);
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
