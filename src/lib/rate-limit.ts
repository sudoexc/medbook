/**
 * In-process fixed-window counters (audit SEC-03).
 *
 * The first version kept every key in one Map forever: each distinct key (and
 * the key used to be a client-controlled X-Forwarded-For value) lived until the
 * process restarted, so a script sending unique headers grew the heap until
 * the CRM fell over. Now:
 *
 *   - expired windows are swept (at most once a minute, and whenever a store
 *     is over its cap), and a store never holds more than `MAX_KEYS_PER_STORE`
 *     keys: past that the oldest windows are dropped first;
 *   - every limiter gets its own named store, so a flood on the public lead
 *     form cannot evict the login-failure counters;
 *   - stores hang off `globalThis`, so the proxy and every route bundle in the
 *     process see the same counters (a lockout recorded by the login route is
 *     honoured by the 2FA pre-flight).
 *
 * Single-process only: the app runs as one Node process behind nginx. Moving
 * this to Redis is the path if that ever changes.
 */

type Entry = { count: number; resetAt: number };
type Store = { map: Map<string, Entry>; lastSweepAt: number };

export const MAX_KEYS_PER_STORE = 20_000;
const SWEEP_EVERY_MS = 60_000;

const REGISTRY_KEY = Symbol.for("medbook.rate-limit.stores");

function registry(): Map<string, Store> {
  const g = globalThis as unknown as Record<symbol, Map<string, Store> | undefined>;
  let reg = g[REGISTRY_KEY];
  if (!reg) {
    reg = new Map();
    g[REGISTRY_KEY] = reg;
  }
  return reg;
}

function storeFor(name: string): Store {
  const reg = registry();
  let s = reg.get(name);
  if (!s) {
    s = { map: new Map(), lastSweepAt: 0 };
    reg.set(name, s);
  }
  return s;
}

function sweep(store: Store, now: number): void {
  store.lastSweepAt = now;
  for (const [key, entry] of store.map) {
    if (entry.resetAt <= now) store.map.delete(key);
  }
  // Still over the cap after dropping expired windows: evict oldest first
  // (a Map iterates in insertion order), down to 90% so we don't re-sweep on
  // every insert while under pressure.
  if (store.map.size > MAX_KEYS_PER_STORE) {
    const target = Math.floor(MAX_KEYS_PER_STORE * 0.9);
    for (const key of store.map.keys()) {
      if (store.map.size <= target) break;
      store.map.delete(key);
    }
  }
}

function maybeSweep(store: Store, now: number): void {
  if (
    now - store.lastSweepAt >= SWEEP_EVERY_MS ||
    store.map.size >= MAX_KEYS_PER_STORE
  ) {
    sweep(store, now);
  }
}

function liveEntry(store: Store, key: string, now: number): Entry | null {
  const entry = store.map.get(key);
  if (!entry) return null;
  if (entry.resetAt <= now) {
    store.map.delete(key);
    return null;
  }
  return entry;
}

/**
 * Count one request against `key`; false once `limit` requests landed in the
 * current `windowMs` window.
 */
export function rateLimit(
  key: string,
  limit = 10,
  windowMs = 60_000,
  storeName = "default",
): boolean {
  const now = Date.now();
  const store = storeFor(storeName);
  maybeSweep(store, now);
  const entry = liveEntry(store, key, now);
  if (!entry) {
    store.map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/**
 * Failure counters: unlike `rateLimit`, reading does not count. Used where
 * only FAILED attempts should spend the budget (login), so a clinic where the
 * whole staff signs in from one office IP is never throttled for succeeding.
 */
export function failureCount(storeName: string, key: string, now = Date.now()): {
  count: number;
  resetAt: number;
} {
  const store = storeFor(storeName);
  const entry = liveEntry(store, key, now);
  return entry ? { count: entry.count, resetAt: entry.resetAt } : { count: 0, resetAt: now };
}

export function recordFailure(
  storeName: string,
  key: string,
  windowMs: number,
  now = Date.now(),
): number {
  const store = storeFor(storeName);
  maybeSweep(store, now);
  const entry = liveEntry(store, key, now);
  if (!entry) {
    store.map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

/**
 * Give back one failure counted up front for an attempt that turned out not to
 * be a failure. `windowResetAt` is the window the failure was counted in: if
 * that window has since expired (or was cleared and restarted), there is
 * nothing of ours left to give back.
 */
export function refundFailure(
  storeName: string,
  key: string,
  windowResetAt: number,
  now = Date.now(),
): void {
  const store = storeFor(storeName);
  const entry = liveEntry(store, key, now);
  if (!entry || entry.resetAt !== windowResetAt) return;
  entry.count--;
  if (entry.count <= 0) store.map.delete(key);
}

export function clearFailures(storeName: string, key: string): void {
  storeFor(storeName).map.delete(key);
}

/** Test hook: how many keys a store currently holds. */
export function storeSize(storeName = "default"): number {
  return storeFor(storeName).map.size;
}

/** Test hook: drop every counter in every store. */
export function __resetRateLimitsForTests(): void {
  registry().clear();
}
