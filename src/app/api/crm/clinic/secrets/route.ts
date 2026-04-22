/**
 * POST /api/crm/clinic/secrets — write clinic-level secret fields.
 *
 * Requires the caller to re-enter their current password — each mutation of
 * an admin-sensitive field goes through this gate.
 *
 * ADMIN only.
 */
import bcrypt from "bcryptjs";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { ClinicSecretsSchema } from "@/server/schemas/settings";

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: ClinicSecretsSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const me = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (!me?.passwordHash) return err("Forbidden", 403, { reason: "no_password" });
    const okPw = await bcrypt.compare(body.currentPassword, me.passwordHash);
    if (!okPw) return err("Forbidden", 403, { reason: "wrong_password" });

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
    });
    if (!clinic) return notFound();

    const data: Record<string, unknown> = {};
    const changed: string[] = [];
    if (body.tgBotToken !== undefined) {
      data.tgBotToken = body.tgBotToken || null;
      changed.push("tgBotToken");
    }
    if (body.tgBotUsername !== undefined) {
      data.tgBotUsername = body.tgBotUsername || null;
      changed.push("tgBotUsername");
    }
    if (body.tgWebhookSecret !== undefined) {
      data.tgWebhookSecret = body.tgWebhookSecret || null;
      changed.push("tgWebhookSecret");
    }
    if (body.smsSenderName !== undefined) {
      data.smsSenderName = body.smsSenderName || null;
      changed.push("smsSenderName");
    }

    if (changed.length === 0) return ok({ updated: false });

    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: data as never,
    });
    await audit(request, {
      action: "clinic.secrets.update",
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: { changedKeys: changed },
    });
    return ok({ updated: true, changed });
  }
);
