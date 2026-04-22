/**
 * Process-local event bus — no-op stub for Phase 3b.
 *
 * The real SSE fan-out lands with `realtime-engineer` (see LOG.md). Until
 * then, callers publish events here; the bus simply forwards to in-process
 * subscribers. When SSE arrives, the bus will:
 *
 *  1. Broadcast to per-clinic SSE channels.
 *  2. Back off onto Redis pub/sub when `REDIS_URL` is set.
 *
 * Keep the module footprint tiny so it can be replaced wholesale. Callers
 * depend only on `publish(channel, payload)`.
 */

type Handler = (payload: unknown) => void;

class EventBus {
  private subs = new Map<string, Set<Handler>>();

  publish(channel: string, payload: unknown): void {
    const set = this.subs.get(channel);
    if (!set) return;
    for (const h of set) {
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
