/**
 * POST /api/crm/me/totp/verify — finish TOTP enrolment.
 *
 * The client submits the 6-digit code typed by the user. The secret to
 * verify against is read from `pendingTotpSecret` on the user row (set by
 * /enroll) — NEVER from the client. This blocks the session-hijack vector
 * where an attacker with a stolen session could swap in their own secret
 * by sending it directly to /verify.
 *
 * On success we promote (pendingTotpSecret → totpSecret), stamp
 * `totpEnabledAt`, write 10 fresh recovery-code hashes, and clear the
 * pending fields. The plaintext recovery codes are returned EXACTLY ONCE.
 *
 * Re-enrolment is blocked at the /enroll layer; this endpoint additionally
 * rejects if `totpEnabledAt` is already set, as belt-and-suspenders.
 */
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";
import { verifyTotpCode } from "@/server/auth/totp";
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from "@/server/auth/recovery-codes";

const Schema = z.object({
  code: z.string().min(6).max(8),
});

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

  if (!rateLimit(`totp-verify:${session.user.id}`, 5, 15 * 60 * 1000)) {
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
  const { code } = parsed.data;

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await hashRecoveryCodes(recoveryCodes);

  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        totpEnabledAt: true,
        pendingTotpSecret: true,
        pendingTotpExpiresAt: true,
      },
    });
    if (!me) return err("NotFound", 404);
    if (me.totpEnabledAt) return err("already_enrolled", 409);
    if (!me.pendingTotpSecret || !me.pendingTotpExpiresAt) {
      return err("enrollment_expired", 400);
    }
    if (me.pendingTotpExpiresAt.getTime() < Date.now()) {
      // Clear the stale pending so the next /enroll starts clean.
      await prisma.user.update({
        where: { id: me.id },
        data: { pendingTotpSecret: null, pendingTotpExpiresAt: null },
      });
      return err("enrollment_expired", 400);
    }

    if (!verifyTotpCode(me.pendingTotpSecret, code)) {
      return err("invalid_code", 400);
    }

    await prisma.user.update({
      where: { id: me.id },
      data: {
        totpSecret: me.pendingTotpSecret,
        totpEnabledAt: new Date(),
        recoveryCodesHash: hashes,
        pendingTotpSecret: null,
        pendingTotpExpiresAt: null,
      },
    });
    return null;
  });
  if (result instanceof Response) return result;

  await audit(request, {
    action: AUDIT_ACTION.TOTP_ENROLLED,
    entityType: "User",
    entityId: session.user.id,
    meta: { recoveryCodeCount: RECOVERY_CODE_COUNT },
  });

  return ok({ recoveryCodes });
}
