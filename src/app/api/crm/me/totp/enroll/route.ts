/**
 * POST /api/crm/me/totp/enroll — start TOTP enrolment.
 *
 * Generates a fresh secret + otpauth URL and PINS it on the user row as
 * (pendingTotpSecret, pendingTotpExpiresAt) with a 10-minute TTL. /verify
 * then matches against this stored secret rather than trusting the client
 * to echo it back, which closes a session-hijack vector where an attacker
 * with a stolen session could enrol their own authenticator by sending an
 * arbitrary secret to /verify.
 *
 * Password re-entry is required even on the very first enrolment so that
 * the same hijack scenario can't silently bind a new TOTP factor to the
 * legitimate user's account.
 *
 * Re-entry: a user who already has TOTP enabled cannot re-enroll without
 * disabling first; the endpoint returns 409. Calling /enroll while a
 * pending secret already exists simply overwrites it (the QR they scanned
 * earlier becomes invalid — surfaced as a UI hint).
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";
import { generateTotpSecret, buildOtpauthUrl } from "@/server/auth/totp";

const Schema = z.object({
  password: z.string().min(1).max(200),
});

const PENDING_TTL_MS = 10 * 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

  if (!rateLimit(`totp-enroll:${session.user.id}`, 5, 15 * 60 * 1000)) {
    return err("RateLimited", 429);
  }

  let parsed;
  try {
    parsed = Schema.safeParse(await request.json());
  } catch {
    return err("InvalidJson", 400);
  }
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }
  const { password } = parsed.data;

  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        totpEnabledAt: true,
        clinic: { select: { nameRu: true } },
      },
    });
    if (!me) return err("NotFound", 404);
    if (me.totpEnabledAt) return err("already_enrolled", 409);
    if (!me.passwordHash) return err("invalid_password", 400);
    const matches = await bcrypt.compare(password, me.passwordHash);
    if (!matches) return err("invalid_password", 400);

    const secret = generateTotpSecret();
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

    await prisma.user.update({
      where: { id: me.id },
      data: {
        pendingTotpSecret: secret,
        pendingTotpExpiresAt: expiresAt,
      },
    });

    const issuer = me.clinic?.nameRu ?? "MedBook CRM";
    const otpauthUrl = buildOtpauthUrl({
      issuer,
      account: me.email,
      secretBase32: secret,
    });

    return ok({ secret, otpauthUrl, expiresAt: expiresAt.toISOString() });
  });

  return result;
}
