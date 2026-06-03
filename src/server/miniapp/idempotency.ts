/**
 * Phase M4 — Idempotency-Key middleware for the Mini App.
 *
 * Per TZ §4.5: `POST /api/miniapp/appointments` and `POST
 * /api/miniapp/account/delete` accept an `Idempotency-Key: <ulid>` header.
 * When present, the server caches the first response keyed by
 * `<clinicId, patientId, key>` for 24 hours; retries return the cached
 * response unchanged.
 *
 * Why we need it: the booking flow is committed by tapping the TG MainButton
 * on a confirmation screen — and the patient can double-tap, or the network
 * can drop after the request was already accepted by the server. Without
 * this layer the patient ends up with two appointments for the same slot
 * (the second one then races with the first and either fails with
 * `doctor_busy` or steals the slot). With it, every render of the
 * confirmation screen generates one fresh key and keeps it until the
 * mutation resolves.
 *
 * Storage: Redis (`miniapp:idem:<clinicId>:<patientId>:<key>`) when
 * `REDIS_URL` is set; in-memory Map fallback otherwise so dev / vitest still
 * work. We never throw — Redis hiccups fall through to the in-memory cache
 * and ultimately to the handler running again.
 *
 * What we cache: the full HTTP response — status, content-type, body text.
 * Anything 5xx is treated as transient and NOT cached (so the next retry can
 * succeed). 4xx IS cached on purpose: a deterministic validation failure
 * (e.g. `doctor_busy`) should be replayed identically so the client doesn't
 * get a different error on retry.
 */
import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";

import { getMetrics } from "@/server/observability/metrics";

const TTL_SECONDS = 24 * 60 * 60;

/** UUID v4, ULID, or any URL-safe id between 8 and 128 chars. */
const KEY_RE = /^[A-Za-z0-9_\-]{8,128}$/;

type CachedResponse = {
  status: number;
  contentType: string;
  body: string;
};

let redisOnce: RedisClient | null = null;
function getRedis(): RedisClient | null {
  if (!process.env.REDIS_URL) return null;
  if (redisOnce) return redisOnce;
  redisOnce = new Redis(process.env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
  });
  redisOnce.on("error", (err) => {
    console.warn("[miniapp:idem] redis", err?.message ?? err);
  });
  return redisOnce;
}

// In-memory fallback. Bounded by a periodic sweep so a misbehaving client
// (one ULID per request, never repeated) cannot grow the map unbounded.
const mem = new Map<string, { value: CachedResponse; expiresAt: number }>();
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of mem) if (v.expiresAt < now) mem.delete(k);
}, 60_000);
// Don't keep the event loop alive for vitest.
sweep.unref?.();

export type IdempotencyScope = { clinicId: string; patientId: string };

function keyFor(scope: IdempotencyScope, key: string): string {
  return `miniapp:idem:${scope.clinicId}:${scope.patientId}:${key}`;
}

async function readCached(k: string): Promise<CachedResponse | null> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(k);
      if (raw) {
        try {
          return JSON.parse(raw) as CachedResponse;
        } catch {
          return null;
        }
      }
    } catch {
      /* fall through to in-memory */
    }
  }
  const ent = mem.get(k);
  if (!ent) return null;
  if (ent.expiresAt < Date.now()) {
    mem.delete(k);
    return null;
  }
  return ent.value;
}

async function writeCached(k: string, v: CachedResponse): Promise<void> {
  const r = getRedis();
  if (r) {
    try {
      await r.set(k, JSON.stringify(v), "EX", TTL_SECONDS);
    } catch {
      /* fall through to in-memory */
    }
  }
  mem.set(k, { value: v, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}

/** Rebuild a Response from a cached payload. Stamps `x-idempotent-replay`
 *  so the client side can tell the difference for logging / dev tools. */
export function rebuildResponse(c: CachedResponse): Response {
  return new Response(c.body, {
    status: c.status,
    headers: {
      "content-type": c.contentType,
      "x-idempotent-replay": "1",
    },
  });
}

/**
 * Wrap a mini-app handler in Idempotency-Key replay support.
 *
 * Without the header → no-op, runs `handler()` unmodified.
 * With a valid header  → cache lookup; hit replays, miss runs + caches.
 * With a malformed header → ignored (same as no header) so a buggy client
 * doesn't lose write semantics; the server log line is enough to debug.
 */
export async function withIdempotency(
  request: Request,
  scope: IdempotencyScope,
  handler: () => Promise<Response>,
): Promise<Response> {
  const raw = request.headers.get("idempotency-key");
  const key = raw?.trim() ?? "";
  if (!key) return handler();
  if (!KEY_RE.test(key)) {
    // Don't fail the whole request on a bad key — just log and skip caching.
    // The booking still goes through; the client just loses retry safety.
    // eslint-disable-next-line no-console
    console.warn("[miniapp:idem] rejected key shape", { length: key.length });
    return handler();
  }
  const k = keyFor(scope, key);
  const hit = await readCached(k);
  if (hit) {
    getMetrics().bookingIdempotencyHits.inc();
    return rebuildResponse(hit);
  }

  const res = await handler();
  if (res.status >= 500) return res; // never cache transient failures
  const cloned = res.clone();
  const body = await cloned.text().catch(() => "");
  const contentType = cloned.headers.get("content-type") ?? "application/json";
  await writeCached(k, { status: res.status, body, contentType });
  return res;
}

/** Testing hook — wipe the in-memory cache so vitest cases don't leak. */
export function __resetIdempotencyForTests(): void {
  mem.clear();
}
