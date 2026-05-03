/**
 * POST /api/crm/me/password — set the current user's password.
 *
 * Authenticated users only. Verifies `currentPassword` (when one is set on
 * the account) before applying the new one. Always clears `mustChangePassword`
 * so the middleware redirect releases.
 *
 * NOTE: deliberately not using `createApiHandler` here — that helper rejects
 * SUPER_ADMINs who haven't impersonated a clinic, but a SUPER_ADMIN should
 * still be able to change their own password from anywhere.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";
import { hashPassword } from "@/server/auth/password";

const Schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200),
});

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

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
  const { currentPassword, newPassword } = parsed.data;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true, mustChangePassword: true },
    });
    if (!user) return err("NotFound", 404);

    // Skip the current-password check the first time someone is signing in
    // with a temp password — the temp password is the "current", but we don't
    // need to re-verify it here since the session already proves they have it.
    // For voluntary changes (mustChangePassword=false), we DO require it.
    if (user.passwordHash && !user.mustChangePassword) {
      if (!currentPassword) {
        return err("validation", 400, { reason: "current_required" });
      }
      const matches = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!matches) return err("invalid_current", 400);
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    return ok({ ok: true });
  });
}
