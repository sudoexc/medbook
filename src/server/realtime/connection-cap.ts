/**
 * Per-key cap on concurrent long-lived connections (audit INF-10).
 *
 * The anonymous board stream (`/api/c/<slug>/queue/events`) needs nothing but
 * a clinic slug, and each open stream holds a socket, a bus subscription and
 * a heartbeat timer for as long as the client likes. Without a cap one
 * machine could open thousands. `rateLimit` counts requests per window, which
 * is the wrong shape for a connection that lives for hours, so this counts
 * the ones currently open and hands back a release function.
 *
 * In-process, like `@/lib/rate-limit`: the app runs as one Node process, and
 * the counters hang off `globalThis` so every route bundle shares them.
 */

type Store = Map<string, number>;

const REGISTRY_KEY = Symbol.for("medbook.connection-cap.stores");

function storeFor(name: string): Store {
  const g = globalThis as unknown as Record<symbol, Map<string, Store> | undefined>;
  let reg = g[REGISTRY_KEY];
  if (!reg) {
    reg = new Map();
    g[REGISTRY_KEY] = reg;
  }
  let store = reg.get(name);
  if (!store) {
    store = new Map();
    reg.set(name, store);
  }
  return store;
}

/**
 * Take one of `max` slots for `key`. Returns the release function, or null
 * when the key already holds `max` open connections. Releasing twice is a
 * no-op, so every cleanup path may call it.
 */
export function acquireConnection(
  storeName: string,
  key: string,
  max: number,
): (() => void) | null {
  const store = storeFor(storeName);
  const open = store.get(key) ?? 0;
  if (open >= max) return null;
  store.set(key, open + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const now = store.get(key) ?? 0;
    if (now <= 1) store.delete(key);
    else store.set(key, now - 1);
  };
}

/** How many connections `key` holds right now. */
export function openConnections(storeName: string, key: string): number {
  return storeFor(storeName).get(key) ?? 0;
}

/** Test hook: forget every counter. */
export function __resetConnectionCapsForTests(): void {
  const g = globalThis as unknown as Record<symbol, Map<string, Store> | undefined>;
  g[REGISTRY_KEY]?.clear();
}
