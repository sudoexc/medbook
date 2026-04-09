/**
 * Server-side receptionist terminal PIN.
 *
 * The PIN MUST be set via the `RECEPTIONIST_PIN` env var. If unset, all PIN
 * checks fail closed — there is no insecure default. The receptionist page
 * itself reads `NEXT_PUBLIC_RECEPTIONIST_PIN` for the client unlock screen,
 * but that value is only a UX gate, not a security boundary.
 *
 * Brute-force defense: per-IP failure tracking. After 5 wrong attempts within
 * 15 minutes the IP is locked out for 15 minutes. State is in-memory and
 * per-process — adequate for a single clinic; swap for Redis if scaled.
 */
const PIN = process.env.RECEPTIONIST_PIN;

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

interface FailureState {
  count: number;
  firstAt: number;
  lockedUntil: number;
}
const failures = new Map<string, FailureState>();

function clientIp(request: Request): string {
  // Trust standard proxy headers; fall back to a constant so the limiter
  // still buckets requests when no header is present.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns true iff the request carries the correct receptionist PIN header.
 * Constant-time comparison is intentional to defeat timing oracles.
 * On repeated failures, the IP is locked out (returns false until cooldown).
 */
export function hasValidPin(request: Request): boolean {
  if (!PIN) return false;
  const provided = request.headers.get("x-terminal-pin");
  if (!provided) return false;

  const ip = clientIp(request);
  const now = Date.now();
  const state = failures.get(ip);

  // Currently locked out — reject without checking the PIN at all.
  if (state && state.lockedUntil > now) return false;

  // Window expired — reset.
  if (state && now - state.firstAt > WINDOW_MS) {
    failures.delete(ip);
  }

  if (constantTimeEqual(provided, PIN)) {
    failures.delete(ip);
    return true;
  }

  // Record failure.
  const cur = failures.get(ip) ?? { count: 0, firstAt: now, lockedUntil: 0 };
  cur.count += 1;
  if (cur.count >= MAX_FAILURES) {
    cur.lockedUntil = now + LOCKOUT_MS;
  }
  failures.set(ip, cur);
  return false;
}
