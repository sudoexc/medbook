/**
 * POST /api/crm/clinic/secrets — replace the clinic's Telegram bot token.
 *
 * Requires the caller to re-enter their current password — each mutation of
 * an admin-sensitive field goes through this gate.
 *
 * What was wrong (audit ST-02). The «Секреты и токены» card wrote whatever
 * its three inputs held, and an input someone typed into and cleared again
 * held "": the server stored `null`. A cleared webhook secret made the
 * webhook answer 401 to every patient message; a cleared or mistyped token
 * silenced the bot and broke the Mini App sign-in (its HMAC key), while the
 * reminders kept showing as sent. A valid new token was stored without
 * telling Telegram, which kept delivering with the old secret.
 *
 * Now only the token can be typed, and:
 *   - an empty value keeps the stored one (nothing is ever blanked here;
 *     disconnecting is the wizard's «Отключить»);
 *   - the token is checked with getMe, and a bot already serving another
 *     clinic is refused;
 *   - the username is taken from Telegram, the webhook secret is generated
 *     here, and setWebhook runs BEFORE anything is saved: if Telegram refuses,
 *     the stored bot keeps working as it was.
 *
 * ADMIN only.
 */
import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { ok, err, notFound } from "@/server/http";
import { ClinicSecretsSchema } from "@/server/schemas/settings";
import { readTgBotToken, writeTgBotToken } from "@/server/crypto/secret-fields";
import {
  deleteWebhook,
  getMe,
  setChatMenuButton,
  setWebhook,
} from "@/server/telegram/bot-api";
import {
  TG_ALLOWED_UPDATES,
  isTelegramTokenShape,
  telegramPublicOrigin,
} from "@/server/telegram/clinic-bot";

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: ClinicSecretsSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    // The password check below is a guessing surface like any other.
    if (!rateLimit(`clinic-secrets:${ctx.userId}`, 5, 15 * 60 * 1000)) {
      return err("RateLimited", 429);
    }

    const me = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (!me?.passwordHash) return err("Forbidden", 403, { reason: "no_password" });
    const okPw = await bcrypt.compare(body.currentPassword, me.passwordHash);
    if (!okPw) return err("Forbidden", 403, { reason: "wrong_password" });

    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { id: true, slug: true, tgBotToken: true, tgBotUsername: true },
    });
    if (!clinic) return notFound();

    // Empty means "keep": the input a hint promised to ignore when blank.
    const token = body.tgBotToken?.trim() ?? "";
    if (!token) return ok({ updated: false });
    if (!isTelegramTokenShape(token)) return err("token_format", 400);

    const meResp = await getMe(token).catch(() => null);
    if (!meResp) return err("network_error", 502);
    if (!meResp.ok) {
      return err(meResp.error_code === 401 ? "invalid_token" : "tg_error", 400, {
        description: meResp.description,
      });
    }
    const bot = meResp.result;

    // One bot serves one clinic: its webhook can point at one URL only.
    const collision = await prisma.clinic.findFirst({
      where: { tgBotUsername: bot.username, NOT: { id: ctx.clinicId } },
      select: { slug: true },
    });
    if (collision) {
      return err("bot_in_use", 409, { otherClinicSlug: collision.slug });
    }

    const origin = telegramPublicOrigin(request);
    if (!origin.startsWith("https://")) {
      return err("https_required", 400, { origin });
    }

    // Register first, save second: a refusal leaves the current bot intact.
    const webhookSecret = randomBytes(32).toString("hex");
    const webhookUrl = `${origin}/api/telegram/webhook/${clinic.slug}`;
    const w = await setWebhook(token, {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: [...TG_ALLOWED_UPDATES],
      // Keep messages patients sent while the swap was in flight.
      drop_pending_updates: false,
    }).catch((e: unknown) => {
      console.error("[clinic.secrets] setWebhook threw:", e);
      return null;
    });
    if (!w) return err("network_error", 502);
    if (!w.ok) {
      return err("webhook_failed", 502, {
        description: w.description ?? null,
        error_code: w.error_code ?? null,
      });
    }

    const warnings: string[] = [];
    const botChanged =
      clinic.tgBotUsername !== null && clinic.tgBotUsername !== bot.username;
    if (botChanged) {
      // The previous bot would keep posting here with a secret we no longer
      // accept. Best effort: it may already be revoked in BotFather.
      const oldToken = readTgBotToken(clinic.tgBotToken);
      if (oldToken) {
        const r = await deleteWebhook(oldToken, false).catch(() => null);
        if (!r || !r.ok) warnings.push("deleteWebhook(previous)");
      }
    }
    if (botChanged || !clinic.tgBotUsername) {
      // A different bot has no Mini App button yet (the wizard sets it up).
      const r = await setChatMenuButton(token, {
        type: "web_app",
        text: "📅",
        web_app: { url: `${origin}/c/${clinic.slug}/my` },
      }).catch(() => null);
      if (!r || !r.ok) warnings.push("setChatMenuButton");
    }

    // Encrypted at rest — the token is also the Mini App HMAC key.
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: {
        tgBotToken: writeTgBotToken(token),
        tgBotUsername: bot.username,
        tgWebhookSecret: webhookSecret,
      } as never,
    });
    await audit(request, {
      action: "clinic.secrets.update",
      entityType: "Clinic",
      entityId: ctx.clinicId,
      // Never the token or the secret themselves.
      meta: {
        changedKeys: ["tgBotToken", "tgBotUsername", "tgWebhookSecret"],
        botUsername: bot.username,
        previousBotUsername: clinic.tgBotUsername,
        webhookUrl,
        warnings,
      },
    });
    return ok({ updated: true, botUsername: bot.username, warnings });
  }
);
