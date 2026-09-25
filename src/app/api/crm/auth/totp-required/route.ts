/**
 * POST /api/crm/auth/totp-required — pre-flight check for the login flow.
 *
 * The /login form posts here BEFORE calling NextAuth's signIn. The endpoint
 * verifies the email + password (without minting a session) and reports
 * `{ requiresTotp: boolean }` plus a short-lived `tfa_pending` cookie when
 * 2FA is enrolled. The login client then either:
 *   - if requiresTotp = false → calls signIn() directly,
 *   - if requiresTotp = true  → routes the user to /login/2fa, where they
 *     submit the 6-digit code and signIn() is called with it.
 *
 * The pending cookie is HMAC-signed and TTL-bound to 5 minutes. The 2fa
 * page reads it but does not require it (defence-in-depth — if the cookie
 * is stripped, the 2fa form just falls back to re-typing the password).
 *
 * It checks a password, so it is subject to the same failed-attempt throttle
 * as the NextAuth credentials callback (audit SEC-02): failures here and there
 * count together, the 6th wrong password for one email within 15 minutes gets
 * 429 on both, and an unknown email costs the same bcrypt time as a known one
 * (it used to answer instantly, which told an attacker which logins exist).
 * The slot is taken before bcrypt runs, so a burst of parallel requests gets
 * 5 password checks, not 500. A right password here only gives the slot back:
 * the sign-in is not complete until NextAuth has seen the second factor.
 *
 * Why this is a separate endpoint instead of using signIn directly:
 *   - signIn returns null on "wrong credentials" AND on "missing 2fa". We
 *     need to distinguish them so the client can route to the right page
 *     instead of just showing "wrong password".
 *   - We never want a partially-authenticated session: until the second
 *     factor is confirmed, no session cookie is issued.
 */
import { z } from "zod";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";
import { PENDING_COOKIE_NAME, signPending } from "@/server/auth/totp-pending";
import { is2faDisabled } from "@/server/auth/security-policy";
import { verifyPasswordConstantTime } from "@/server/auth/password";
import {
  beginLoginAttempt,
  tooManyAttemptsResponse,
} from "@/server/auth/login-throttle";
import { isKnownLoginSource } from "@/server/auth/login-sources";
import { realClientIp } from "@/lib/client-ip";

const Schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request): Promise<Response> {
  let parsed;
  try {
    const raw = await request.json();
    parsed = Schema.safeParse(raw);
  } catch {
    return err("InvalidJson", 400);
  }
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }
  const { email, password } = parsed.data;

  const ip = realClientIp(request);
  const attempt = await beginLoginAttempt(
    { ip, email },
    { isKnownSource: () => isKnownLoginSource(email, ip) },
  );
  if (attempt.blocked) return tooManyAttemptsResponse(attempt);

  let user;
  let valid: boolean;
  try {
    // We don't want to leak account existence via timing or response body.
    // Returning the same shape on both wrong-creds and unknown-user keeps
    // the surface uniform, and every path spends one bcrypt comparison.
    user = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          passwordHash: true,
          active: true,
          totpEnabledAt: true,
        },
      }),
    );
    valid = await verifyPasswordConstantTime(password, user?.passwordHash);
  } catch (e) {
    // A crash is not a wrong password: do not spend the caller's budget.
    attempt.release();
    throw e;
  }
  if (!user || !user.active || !valid) {
    // The slot taken above already counts as this failure.
    return err("invalid_credentials", 401);
  }
  // Right password, but no session yet: NextAuth counts the real sign-in.
  attempt.release();

  // Kill-switch: when DISABLE_2FA is set we never gate the login on TOTP,
  // even for enrolled users. Skip the pending-cookie too — the login
  // client will call signIn() directly with password only.
  if (is2faDisabled()) {
    return ok({ requiresTotp: false });
  }

  const requiresTotp = Boolean(user.totpEnabledAt);

  if (requiresTotp) {
    const store = await cookies();
    const token = signPending(user.id);
    store.set(PENDING_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 5 * 60, // 5 min — matches verifyPending's TTL
    });
  }

  return ok({ requiresTotp });
}
