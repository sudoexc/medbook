/**
 * POST /api/crm/me/totp/recovery-codes/regenerate — issue a fresh batch.
 *
 * Same password-reentry guard as /disable: an attacker who hijacks a
 * session should not be able to lock the legitimate user out by quietly
 * rotating recovery codes (the regeneration replaces the old hash array).
 *
 * Returns the 10 plaintext codes ONCE.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from "@/server/auth/recovery-codes";

const Schema = z.object({
  password: z.string().min(1).max(200),
});

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

  if (!rateLimit(`totp-regen:${session.user.id}`, 5, 15 * 60 * 1000)) {
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

  const newCodes = generateRecoveryCodes();
  const hashes = await hashRecoveryCodes(newCodes);

  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true, totpEnabledAt: true },
    });
    if (!me) return err("NotFound", 404);
    if (!me.totpEnabledAt) return err("not_enrolled", 400);
    if (!me.passwordHash) return err("invalid_password", 400);
    const matches = await bcrypt.compare(password, me.passwordHash);
    if (!matches) return err("invalid_password", 400);

    await prisma.user.update({
      where: { id: me.id },
      data: { recoveryCodesHash: hashes },
    });
    return null;
  });
  if (result instanceof Response) return result;

  await audit(request, {
    action: AUDIT_ACTION.RECOVERY_CODES_REGENERATED,
    entityType: "User",
    entityId: session.user.id,
    meta: { recoveryCodeCount: RECOVERY_CODE_COUNT },
  });

  return ok({ recoveryCodes: newCodes });
}
