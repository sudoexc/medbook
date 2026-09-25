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
 * peer address (`realClientIp`, from nginx's X-Real-IP; an IPv6 address by its
 * /64, see `ipBucket`) and on the email:
 *
 *   - email + IP: 5 failures / 15 min — the everyday "someone is guessing this
 *     account" case; the 6th attempt gets 429 on both the pre-flight and the
 *     NextAuth credentials callback. This one always blocks;
 *   - IP alone:  30 failures / 15 min — one address spraying many accounts;
 *   - email alone: 50 failures / 15 min — one account attacked from many
 *     addresses.
 *
 * The two shared buckets do NOT block a source this account signed in from
 * recently (`isKnownSource`, backed by StaffLoginSource). Otherwise anyone
 * could lock a doctor out of the clinic PC: 25 wrong passwords from each of
 * two addresses fill her account-wide bucket, and a guest on the clinic's
 * Wi-Fi (same NAT address) fills the per-IP one for the whole clinic. Both
 * stay hard blocks for an address the account has not signed in from.
 *
 * Slot first, password second. An attempt takes its slot BEFORE the password
 * is checked (`beginLoginAttempt`): the check and the count happen in one
 * synchronous step, and the attempt is counted as a failure unless it proves
 * otherwise. Reading the counters and recording the failure after bcrypt let a
 * burst of parallel requests all see "0 failures" and try 500 passwords at
 * once.
 *
 * A successful sign-in clears the email + IP bucket, so a user who
 * fat-fingered their password four times is not left one typo away from a
 * lockout. It does not reset the account-wide bucket: the victim's own daily
 * sign-in must not hand an attacker a fresh budget.
 */
import { clearFailures, failureCount, recordFailure, refundFailure } from "@/lib/rate-limit";
import { ipBucket } from "@/lib/client-ip";

export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAILURE_LIMITS = {
  emailIp: 5,
  ip: 30,
  email: 50,
} as const;

const STORE = "login-failures";

type Who = { ip: string; email: string | null | undefined };

type Keys = { emailIp: string | null; ip: string; email: string | null };

function normEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e.slice(0, 200) : null;
}

function keys(who: Who): Keys {
  const email = normEmail(who.email);
  const ip = ipBucket(who.ip);
  return {
    emailIp: email ? `ei:${email}|${ip}` : null,
    ip: `ip:${ip}`,
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

export type ThrottleOptions = {
  /**
   * Has this email signed in successfully from this address recently? Asked
   * only when a shared bucket is full, so a normal login costs no lookup.
   */
  isKnownSource?: () => Promise<boolean>;
  /** Test clock. */
  now?: number;
};

/** When a full bucket reopens, or 0 when it is not full. */
function fullUntil(key: string | null, limit: number, now: number): number {
  if (!key) return 0;
  const { count, resetAt } = failureCount(STORE, key, now);
  return count >= limit ? resetAt : 0;
}

function pressure(k: Keys, now: number): { pair: number; shared: number } {
  return {
    pair: fullUntil(k.emailIp, LOGIN_FAILURE_LIMITS.emailIp, now),
    shared: Math.max(
      fullUntil(k.ip, LOGIN_FAILURE_LIMITS.ip, now),
      fullUntil(k.email, LOGIN_FAILURE_LIMITS.email, now),
    ),
  };
}

/** 0 = open; otherwise when the caller may try again. */
function blockedUntil(k: Keys, now: number, knownSource: boolean): number {
  const { pair, shared } = pressure(k, now);
  return Math.max(pair, knownSource ? 0 : shared);
}

function statusFor(until: number, now: number): ThrottleStatus {
  if (!until) return { blocked: false, retryAfterSec: 0 };
  return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((until - now) / 1000)) };
}

async function askKnownSource(opts: ThrottleOptions): Promise<boolean> {
  if (!opts.isKnownSource) return false;
  try {
    return await opts.isKnownSource();
  } catch {
    // Cannot tell: the shared buckets apply, as they do to any stranger.
    return false;
  }
}

/**
 * Resolve the known-source question only if it can change the answer, then
 * hand the caller a moment with no await between the final look at the
 * counters and whatever it does with the verdict.
 */
async function gate<T>(
  k: Keys,
  opts: ThrottleOptions,
  decide: (until: number, now: number) => T,
): Promise<T> {
  let known: boolean | null = null;
  for (;;) {
    const now = opts.now ?? Date.now();
    const { pair, shared } = pressure(k, now);
    if (known === null && shared && !pair) {
      known = await askKnownSource(opts);
      // Other requests ran while we waited: look at the counters again.
      continue;
    }
    return decide(blockedUntil(k, now, known === true), now);
  }
}

/** Would an attempt be refused right now? Reading does not count. */
export async function checkLoginThrottle(
  who: Who,
  opts: ThrottleOptions = {},
): Promise<ThrottleStatus> {
  if (loginThrottleDisabled()) return { blocked: false, retryAfterSec: 0 };
  return gate(keys(who), opts, statusFor);
}

export type LoginAttempt =
  | { blocked: true; retryAfterSec: number }
  | {
      blocked: false;
      retryAfterSec: 0;
      /** Signed in: clear this address's failures for the account and give
       *  back the shared slots. */
      succeeded(): void;
      /** Neither a success nor a failure (the password was right but a second
       *  factor is still to come, or the check itself crashed). */
      release(): void;
    };

const NOOP_ATTEMPT: LoginAttempt = {
  blocked: false,
  retryAfterSec: 0,
  succeeded() {},
  release() {},
};

/**
 * Take a slot for one password check. Refuses (429) when the caller is locked
 * out; otherwise the attempt is already counted as a failure in every bucket,
 * and stays one unless `succeeded()` or `release()` is called.
 */
export async function beginLoginAttempt(
  who: Who,
  opts: ThrottleOptions = {},
): Promise<LoginAttempt> {
  if (loginThrottleDisabled()) return NOOP_ATTEMPT;
  const k = keys(who);
  const clock = () => opts.now ?? Date.now();
  return gate(k, opts, (until, now): LoginAttempt => {
    if (until) return { blocked: true, retryAfterSec: statusFor(until, now).retryAfterSec };
    // Same synchronous step as the check above: a parallel request cannot
    // slip in between and see the slot as free.
    const taken: Array<[string, number]> = [];
    for (const key of [k.emailIp, k.ip, k.email]) {
      if (!key) continue;
      recordFailure(STORE, key, LOGIN_FAILURE_WINDOW_MS, now);
      taken.push([key, failureCount(STORE, key, now).resetAt]);
    }
    let settled = false;
    const giveBack = (skip: string | null) => {
      const t = clock();
      for (const [key, resetAt] of taken) {
        if (key !== skip) refundFailure(STORE, key, resetAt, t);
      }
    };
    return {
      blocked: false,
      retryAfterSec: 0,
      succeeded() {
        if (settled) return;
        settled = true;
        if (k.emailIp) clearFailures(STORE, k.emailIp);
        giveBack(k.emailIp);
      },
      release() {
        if (settled) return;
        settled = true;
        giveBack(null);
      },
    };
  });
}

/** Count one failure without an attempt slot (tests, and nothing else). */
export function recordLoginFailure(who: Who, now = Date.now()): void {
  if (loginThrottleDisabled()) return;
  const k = keys(who);
  for (const key of [k.emailIp, k.ip, k.email]) {
    if (key) recordFailure(STORE, key, LOGIN_FAILURE_WINDOW_MS, now);
  }
}

/** The 429 body/headers both login entry points answer with. */
export function tooManyAttemptsResponse(
  status: { retryAfterSec: number },
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    { error: "too_many_attempts", retryAfterSec: status.retryAfterSec, ...extra },
    { status: 429, headers: { "retry-after": String(status.retryAfterSec) } },
  );
}
