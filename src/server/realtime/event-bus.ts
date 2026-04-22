/**
 * Realtime event bus.
 *
 * Two layers:
 *
 *  1. **In-process pub/sub** — every process hosts a tiny `EventBus` that
 *     SSE handlers subscribe to. Publishers always go through the local bus
 *     so a single-node deployment needs no infrastructure.
 *
 *  2. **Redis fan-out (optional)** — when `REDIS_URL` is set, `publishEvent`
 *     (see `./publish.ts`) mirrors events to `events:<clinicId>` via
 *     ioredis PUBLISH, and each process's bus subscribes via a dedicated
 *     Redis SUBSCRIBE client so remote events reach local SSE subscribers.
 *
 * The bus deals in opaque channel strings + payloads; validation lives in
 * `publish.ts` where the Zod schema is enforced. Keep this module tiny and
 * dependency-free so it can be imported from workers, webhooks, and API
 * handlers without pulling heavy deps eagerly.
 *
 * ## Backward compatibility
 *
 * Phase 3b publishers used `publish(channel, payload)` directly. Those
 * string channels (e.g. `tg.message.new`, `call.incoming`, `telephony.*`)
 * are still accepted — they just don't enjoy Zod validation or SSE fan-out.
 * New code should use `publishEvent()` instead.
 */

type Handler = (payload: unknown) => void;

class EventBus {
  private subs = new Map<string, Set<Handler>>();

  publish(channel: string, payload: unknown): void {
    const set = this.subs.get(channel);
    if (!set) return;
    // Snapshot to guard against handlers that unsubscribe during dispatch.
    for (const h of Array.from(set)) {
      try {
        h(payload);
      } catch (e) {
        console.warn(`[event-bus] handler for ${channel} threw`, e);
      }
    }
  }

  subscribe(channel: string, handler: Handler): () => void {
    let set = this.subs.get(channel);
    if (!set) {
      set = new Set();
      this.subs.set(channel, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
      if (set && set.size === 0) this.subs.delete(channel);
    };
  }

  /** Number of subscribers on a channel — useful for tests + diagnostics. */
  size(channel: string): number {
    return this.subs.get(channel)?.size ?? 0;
  }
}

let singleton: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!singleton) singleton = new EventBus();
  return singleton;
}

/** Convenience: publish to the default bus. */
export function publish(channel: string, payload: unknown): void {
  getEventBus().publish(channel, payload);
}

/** Convenience: subscribe on the default bus. */
export function subscribe(
  channel: string,
  handler: (payload: unknown) => void,
): () => void {
  return getEventBus().subscribe(channel, handler);
}
