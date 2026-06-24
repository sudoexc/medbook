/**
 * PATCH /api/me — self-service updates to the caller's own User row.
 *
 * Currently the only mutable field is `preferredLocale` (staff UI language).
 * The language switcher calls this best-effort on every toggle so the choice
 * is persisted server-side and survives across devices/browsers — the cookie
 * alone is per-browser. Sign-in re-seeds the NEXT_LOCALE cookie from this
 * value (see src/lib/auth.ts) so a fresh browser lands in the saved language.
 *
 * Any authenticated role may edit its own row (no `roles` gate). `User` lives
 * in MODELS_WITHOUT_TENANT, so the PK update is not clinic-scoped and works
 * for SUPER_ADMIN too. Audit: USER_LOCALE_UPDATED.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";

const PatchBody = z.object({
  locale: z.enum(["ru", "uz"]),
});

export const PATCH = createApiHandler(
  { bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    // SYSTEM context never reaches a request handler, but the union includes it
    // and it carries no userId — narrow to the authenticated kinds.
    if (ctx.kind === "SYSTEM") return err("Forbidden", 403);
    const userId = ctx.userId;

    await prisma.user.update({
      where: { id: userId },
      data: { preferredLocale: body.locale },
    });

    await audit(request, {
      action: AUDIT_ACTION.USER_LOCALE_UPDATED,
      entityType: "User",
      entityId: userId,
      meta: { locale: body.locale },
    });

    return ok({ locale: body.locale });
  },
);
