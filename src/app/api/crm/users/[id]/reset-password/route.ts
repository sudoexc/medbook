/**
 * POST /api/crm/users/[id]/reset-password
 *
 * Sets a new password for a clinic user. ADMIN only, tenant-scoped.
 * If `newPassword` is omitted, a random 12-char password is generated
 * and returned once (operator hands it to the user).
 */
import bcrypt from "bcryptjs";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { ResetPasswordSchema } from "@/server/schemas/settings";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /api/crm/users/[id]/reset-password → id is second-to-last
  return parts[parts.length - 2] ?? "";
}

function randomPassword(len = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) {
    out += alphabet.charAt(arr[i]! % alphabet.length);
  }
  return out;
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: ResetPasswordSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const user = await prisma.user.findFirst({
      where: { id, clinicId: ctx.clinicId },
    });
    if (!user) return notFound();

    const generated = body.newPassword ? null : randomPassword(12);
    const newPassword = body.newPassword ?? generated!;
    const hash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id },
      data: { passwordHash: hash, mustChangePassword: true },
    });

    await audit(request, {
      action: "user.reset_password",
      entityType: "User",
      entityId: id,
      meta: { by: ctx.userId, generated: Boolean(generated) },
    });

    return ok({
      id,
      generatedPassword: generated,
      reset: true,
    });
  }
);
