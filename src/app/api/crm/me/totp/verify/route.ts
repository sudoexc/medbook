/**
 * POST /api/crm/me/totp/verify — finish TOTP enrolment.
 *
 * The client has the (secret, otpauthUrl) pair from /enroll plus a
 * 6-digit code typed by the user. We verify the code, persist the secret
 * + totpEnabledAt + 10 fresh recovery codes (bcrypt-hashed), and return
 * the plaintext recovery codes EXACTLY ONCE. The user is responsible for
 * saving / printing them; the server cannot reproduce them.
 *
 * Re-enrolment is blocked at the /enroll layer; this endpoint additionally
 * rejects if `totpEnabledAt` is already set, as belt-and-suspenders.
 */
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
  secret: z.string().min(16).max(200),
  code: z.string().min(6).max(8),
});

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

  let parsed;
  try {
    parsed = Schema.safeParse(await request.json());
  } catch {
    return err("InvalidJson", 400);
  }
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }
  const { secret, code } = parsed.data;

  if (!verifyTotpCode(secret, code)) {
    return err("invalid_code", 400);
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashes = await hashRecoveryCodes(recoveryCodes);

  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, totpEnabledAt: true },
    });
    if (!me) return err("NotFound", 404);
    if (me.totpEnabledAt) return err("already_enrolled", 409);

    await prisma.user.update({
      where: { id: me.id },
      data: {
        totpSecret: secret,
        totpEnabledAt: new Date(),
        recoveryCodesHash: hashes,
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
