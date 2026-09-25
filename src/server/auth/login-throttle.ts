/**
 * Failed-login throttle shared by every place that checks a staff password
 * (audit SEC-02 / SEC-03).
 *
 * Before this, the only limit was "5 POSTs a minute per IP" on /api/auth/*:
 *   - the IP came from the client-written X-Forwarded-For, so a script changed
 *     it per request and brute-forced without limit;
 *   - the anonymous 2FA pre-flight (/api/crm/auth/totp-required) checks the
 *     password too and had no limit at all;
 *   - successful logins, sign-outs and session refreshes spent the same budget,
 *     so the sixth receptionist to sign in from the clinic's single office IP
 *     in a minute was locked out, and «Выйти» could silently fail.
 *
 * Now only FAILED password (or second-factor) checks count, keyed on the real
 * peer address (`realClientIp`, from nginx's X-Real-IP) and on the email:
 *
 *   - email + IP: 5 failures / 15 min — the everyday "someone is guessing this
 *     account" case; the 6th attempt gets 429 on both the pre-flight and the
 *     NextAuth credentials callback;
 *   - IP alone:  30 failures / 15 min — one address spraying many accounts;
 *   - email alone: 50 failures / 15 min — one account attacked from many
 *     addresses. Set high on purpose: an outsider who knows a doctor's login
 *     must not be able to lock that doctor out with a handful of requests.
 *
 * A successful sign-in clears the email counters, so a user who fat-fingered
 * their password four times is not left one typo away from a lockout.
 */
import { clearFailures, failureCount, recordFailure } from "@/lib/rate-limit";

export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_LIMITS = {
  emailIp: 5,
  ip: 30,
  email: 50,
} as const;

const STORE = "login-failures";

type Who = { ip: string; email: string | null | undefined };

function normEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e.slice(0, 200) : null;
}

function keys(who: Who): { emailIp: string | null; ip: string; email: string | null } {
  const email = normEmail(who.email);
  return {
    emailIp: email ? `ei:${email}|${who.ip}` : null,
    ip: `ip:${who.ip}`,
    email: email ? `e:${email}` : null,
  };
}

/**
 * Dev / e2e bypass, same switch the old per-IP limiter honoured. Playwright
 * logs many users in within a minute and deliberately types wrong passwords.
 */
export function loginThrottleDisabled(): boolean {
  const v = process.env.DISABLE_AUTH_RATE_LIMIT;
  return v === "1" || v === "true";
}

export type ThrottleStatus = { blocked: boolean; retryAfterSec: number };

/** Is this caller currently locked out? Reading does not count as an attempt. */
export function checkLoginThrottle(who: Who, now = Date.now()): ThrottleStatus {
  if (loginThrottleDisabled()) return { blocked: false, retryAfterSec: 0 };
  const k = keys(who);
  const checks: Array<[string | null, number]> = [
    [k.emailIp, LOGIN_FAILURE_LIMITS.emailIp],
    [k.ip, LOGIN_FAILURE_LIMITS.ip],
    [k.email, LOGIN_FAILURE_LIMITS.email],
  ];
  let retryAt = 0;
  for (const [key, limit] of checks) {
    if (!key) continue;
    const { count, resetAt } = failureCount(STORE, key, now);
    if (count >= limit) retryAt = Math.max(retryAt, resetAt);
  }
  if (retryAt === 0) return { blocked: false, retryAfterSec: 0 };
  return {
    blocked: true,
    retryAfterSec: Math.max(1, Math.ceil((retryAt - now) / 1000)),
  };
}

export function recordLoginFailure(who: Who, now = Date.now()): void {
  if (loginThrottleDisabled()) return;
  const k = keys(who);
  for (const key of [k.emailIp, k.ip, k.email]) {
    if (key) recordFailure(STORE, key, LOGIN_FAILURE_WINDOW_MS, now);
  }
}

export function recordLoginSuccess(who: Who): void {
  const k = keys(who);
  if (k.emailIp) clearFailures(STORE, k.emailIp);
  if (k.email) clearFailures(STORE, k.email);
}

/** The 429 body/headers both login entry points answer with. */
export function tooManyAttemptsResponse(
  status: ThrottleStatus,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { error: "too_many_attempts", retryAfterSec: status.retryAfterSec, ...extra },
    { status: 429, headers: { "retry-after": String(status.retryAfterSec) } },
  );
}
