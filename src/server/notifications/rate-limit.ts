/**
 * Per-patient notification rate limit.
 *
 * Current defaults (TZ §6.9):
 *   SMS: max 3 per hour per patient
 *   TG:  max 10 per minute per patient
 *
 * Backend: in-memory sliding window Map today. When `REDIS_URL` is set,
 * `infrastructure-engineer` (Phase 6) can swap in a Redis INCR/EXPIRE
 * implementation behind the same interface — see `createRateLimiter`.
 *
 * The sliding window is a simple "per-key timestamps array, drop expired,
 * count remaining" algorithm. Cheap enough at clinic scale.
 */

export type Channel = "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";

export type RateLimitConfig = {
  windowMs: number;
  maxHits: number;
};

export const DEFAULT_LIMITS: Record<Channel, RateLimitConfig | null> = {
  SMS: { windowMs: 60 * 60 * 1000, maxHits: 3 },
  TG: { windowMs: 60 * 1000, maxHits: 10 },
  EMAIL: { windowMs: 60 * 60 * 1000, maxHits: 20 },
  CALL: null,
  VISIT: null,
};

export interface RateLimiter {
  /** Returns true if allowed, false if rate-limited. Records the hit on allow. */
  check(patientId: string, channel: Channel): Promise<boolean>;
  /** Peek remaining budget without recording a hit. */
  remaining(patientId: string, channel: Channel): Promise<number>;
  /** Clear state (test utility). */
  reset(): Promise<void>;
}

/** In-memory implementation — good enough for dev and single-node prod. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limits: Record<Channel, RateLimitConfig | null> = DEFAULT_LIMITS,
  ) {}

  private keyOf(patientId: string, channel: Channel): string {
    return `${patientId}:${channel}`;
  }

  private prune(key: string, windowMs: number, now: number): number[] {
    const arr = this.hits.get(key) ?? [];
    const cutoff = now - windowMs;
    const kept = arr.filter((t) => t > cutoff);
    if (kept.length !== arr.length) this.hits.set(key, kept);
    return kept;
  }

  async check(patientId: string, channel: Channel): Promise<boolean> {
    const cfg = this.limits[channel];
    if (!cfg) return true;
    const key = this.keyOf(patientId, channel);
    const now = Date.now();
    const current = this.prune(key, cfg.windowMs, now);
    if (current.length >= cfg.maxHits) return false;
    current.push(now);
    this.hits.set(key, current);
    return true;
  }

  async remaining(patientId: string, channel: Channel): Promise<number> {
    const cfg = this.limits[channel];
    if (!cfg) return Number.POSITIVE_INFINITY;
    const key = this.keyOf(patientId, channel);
    const current = this.prune(key, cfg.windowMs, Date.now());
    return Math.max(0, cfg.maxHits - current.length);
  }

  async reset(): Promise<void> {
    this.hits.clear();
  }
}

let singleton: RateLimiter | null = null;

/**
 * Lazy-create the process-wide rate limiter. Later we can branch on
 * `process.env.REDIS_URL` to return a Redis-backed implementation.
 */
export function getRateLimiter(): RateLimiter {
  if (!singleton) {
    singleton = new InMemoryRateLimiter();
  }
  return singleton;
}

/** Test-only: replace the singleton. */
export function __setRateLimiterForTests(limiter: RateLimiter | null) {
  singleton = limiter;
}
