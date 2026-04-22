/**
 * POST /api/crm/integrations/verify-password — used by the settings UI before
 * opening a token/secret editor. Returns 200 on match, 403 on mismatch.
 *
 * ADMIN only.
 */
import { z } from "zod";
import bcrypt from "bcryptjs";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

const Schema = z.object({
  password: z.string().min(1).max(200),
});

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const me = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (!me?.passwordHash) return err("Forbidden", 403, { reason: "no_password" });
    const okPw = await bcrypt.compare(body.password, me.passwordHash);
    if (!okPw) return err("Forbidden", 403, { reason: "wrong_password" });
    return ok({ ok: true });
  }
);
