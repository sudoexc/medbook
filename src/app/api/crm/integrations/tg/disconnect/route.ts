/**
 * POST /api/crm/integrations/tg/disconnect — fully unlink the clinic's bot.
 *
 * Steps:
 *   1. Call Telegram deleteWebhook (best-effort — the bot may have been
 *      revoked from BotFather already, in which case Telegram returns 401
 *      and we still proceed to clear our DB fields).
 *   2. Null out tgBotToken / tgBotUsername / tgWebhookSecret on Clinic.
 *   3. Audit.
 *
 * Idempotent: calling on an already-disconnected clinic is a no-op that
 * returns ok.
 *
 * ADMIN only.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { deleteWebhook } from "@/server/telegram/bot-api";
import { z } from "zod";

const Schema = z.object({}).optional();

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { id: true, tgBotToken: true, tgBotUsername: true },
    });
    if (!clinic) return err("NotFound", 404);
    if (!clinic.tgBotToken) {
      // Already disconnected — return ok so the wizard doesn't show an error
      // when a user clicks Disconnect twice in a row.
      return ok({ alreadyDisconnected: true });
    }

    const previousUsername = clinic.tgBotUsername ?? null;
    let telegramOk = false;
    let telegramError: string | null = null;
    const r = await deleteWebhook(clinic.tgBotToken, true).catch(
      () => null,
    );
    if (r && r.ok) telegramOk = true;
    else if (r && !r.ok) telegramError = r.description;

    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: {
        tgBotToken: null,
        tgBotUsername: null,
        tgWebhookSecret: null,
      } as never,
    });

    await audit(request, {
      action: "tg.disconnect",
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: { previousUsername, telegramOk, telegramError },
    });

    return ok({ telegramOk, telegramError });
  },
);
