/**
 * POST /api/crm/me/totp/disable — turn off TOTP for the current user.
 *
 * Requires re-entering the password to defeat session hijacking: an
 * attacker who steals a logged-in session should not be able to silently
 * disable 2FA without the user's password. Mandatory ADMIN/SUPER_ADMIN
 * enrollment is enforced at the proxy layer; this endpoint does NOT
 * differentiate by role — the proxy will simply force re-enrollment if
 * the user disables and is in a mandatory role.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";

const Schema = z.object({
  password: z.string().min(1).max(200),
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
  const { password } = parsed.data;

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
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        recoveryCodesHash: [],
      },
    });
    return null;
  });
  if (result instanceof Response) return result;

  await audit(request, {
    action: AUDIT_ACTION.TOTP_DISABLED,
    entityType: "User",
    entityId: session.user.id,
    meta: {},
  });

  return ok({ ok: true });
}
