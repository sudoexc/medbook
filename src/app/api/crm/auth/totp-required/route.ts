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
 * Why this is a separate endpoint instead of using signIn directly:
 *   - signIn returns null on "wrong credentials" AND on "missing 2fa". We
 *     need to distinguish them so the client can route to the right page
 *     instead of just showing "wrong password".
 *   - We never want a partially-authenticated session: until the second
 *     factor is confirmed, no session cookie is issued.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";
import { PENDING_COOKIE_NAME, signPending } from "@/server/auth/totp-pending";
import { is2faDisabled } from "@/server/auth/security-policy";

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

  // We don't want to leak account existence via timing or response body.
  // Returning the same shape on both wrong-creds and unknown-user keeps
  // the surface uniform.
  const user = await runWithTenant({ kind: "SYSTEM" }, () =>
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

  if (!user || !user.passwordHash || !user.active) {
    return err("invalid_credentials", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return err("invalid_credentials", 401);

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
