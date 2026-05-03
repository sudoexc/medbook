/**
 * POST /api/crm/integrations/tg/connect — full bot setup in one shot.
 *
 * Designed to be called by the wizard after the user confirms the bot preview.
 * Performs (in order):
 *   1. Re-validate the token via getMe and verify the username matches what
 *      the user confirmed (defends against a tampered request body).
 *   2. Auxiliary configuration (best-effort, individual failures don't roll
 *      back the connection — they're surfaced as warnings):
 *        a. setMyCommands (RU + UZ + default)
 *        b. setMyDescription / setMyShortDescription
 *        c. setChatMenuButton with the Mini App URL.
 *   3. Webhook registration via setWebhook (production-only — the public
 *      origin comes from $NEXT_PUBLIC_APP_URL and must be HTTPS).
 *   4. Persist tgBotToken / tgBotUsername / tgWebhookSecret to Clinic.
 *   5. Audit log.
 *
 * ADMIN only.
 */
import { randomBytes } from "node:crypto";

import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import {
  getMe,
  getWebhookInfo,
  setChatMenuButton,
  setMyCommands,
  setMyDescription,
  setMyShortDescription,
  setWebhook,
  type TgBotCommand,
} from "@/server/telegram/bot-api";

const Schema = z.object({
  token: z
    .string()
    .min(20)
    .max(80)
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "format"),
  /** Username confirmed by the user in step 3 of the wizard. */
  expectedUsername: z.string().min(3),
  /** Toggles for the optional auxiliary setup steps. */
  setupCommands: z.boolean().default(true),
  setupDescription: z.boolean().default(true),
  setupMenuButton: z.boolean().default(true),
});

const COMMANDS_RU: TgBotCommand[] = [
  { command: "start", description: "Начать" },
  { command: "booking", description: "Записаться на приём" },
  { command: "cancel", description: "Отменить запись" },
  { command: "help", description: "Помощь" },
];

const COMMANDS_UZ: TgBotCommand[] = [
  { command: "start", description: "Boshlash" },
  { command: "booking", description: "Qabulga yozilish" },
  { command: "cancel", description: "Yozilishni bekor qilish" },
  { command: "help", description: "Yordam" },
];

const DESCRIPTION_RU =
  "Бот клиники для записи на приём, напоминаний и связи с регистратурой.";
const SHORT_DESCRIPTION_RU = "Запись на приём и связь с клиникой";

const DESCRIPTION_UZ =
  "Klinika boti — qabulga yozilish, eslatmalar va ro'yxatxona bilan bog'lanish.";
const SHORT_DESCRIPTION_UZ = "Qabulga yozilish va klinika bilan aloqa";

function publicOrigin(request: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // Step 1 — re-validate token and verify username.
    const meResp = await getMe(body.token).catch(() => null);
    if (!meResp) return err("network_error", 502);
    if (!meResp.ok) {
      return err(meResp.error_code === 401 ? "invalid_token" : "tg_error", 400, {
        description: meResp.description,
      });
    }
    const me = meResp.result;
    if (me.username !== body.expectedUsername) {
      // The token resolves to a different bot than the user confirmed.
      return err("username_mismatch", 400, {
        actual: me.username,
        expected: body.expectedUsername,
      });
    }

    // Refuse if the same username is bound to a DIFFERENT clinic in this DB.
    // A second call from the same clinic is fine — re-running the wizard.
    const collision = await prisma.clinic.findFirst({
      where: {
        tgBotUsername: me.username,
        NOT: { id: ctx.clinicId },
      },
      select: { slug: true },
    });
    if (collision) {
      return err("bot_in_use", 409, { otherClinicSlug: collision.slug });
    }

    const origin = publicOrigin(request);
    if (!origin.startsWith("https://")) {
      // Webhook + Mini-App both require HTTPS — refuse rather than silently
      // produce a bot that can't be reached.
      return err("https_required", 400, { origin });
    }
    const webhookSecret = randomBytes(32).toString("hex");

    // Step 2 — auxiliary setup. Each call is best-effort; we accumulate
    // warnings rather than fail the whole connect.
    const warnings: string[] = [];
    if (body.setupCommands) {
      const r1 = await setMyCommands(body.token, COMMANDS_RU, "ru").catch(
        () => null,
      );
      if (!r1 || !r1.ok) warnings.push("setMyCommands(ru)");
      const r2 = await setMyCommands(body.token, COMMANDS_UZ, "uz").catch(
        () => null,
      );
      if (!r2 || !r2.ok) warnings.push("setMyCommands(uz)");
      // Default falls back to RU when neither ru/uz fits — sensible for UZ.
      const r3 = await setMyCommands(body.token, COMMANDS_RU).catch(() => null);
      if (!r3 || !r3.ok) warnings.push("setMyCommands(default)");
    }
    if (body.setupDescription) {
      const d1 = await setMyDescription(body.token, DESCRIPTION_RU, "ru").catch(
        () => null,
      );
      if (!d1 || !d1.ok) warnings.push("setMyDescription(ru)");
      const d2 = await setMyDescription(body.token, DESCRIPTION_UZ, "uz").catch(
        () => null,
      );
      if (!d2 || !d2.ok) warnings.push("setMyDescription(uz)");
      const s1 = await setMyShortDescription(
        body.token,
        SHORT_DESCRIPTION_RU,
        "ru",
      ).catch(() => null);
      if (!s1 || !s1.ok) warnings.push("setMyShortDescription(ru)");
      const s2 = await setMyShortDescription(
        body.token,
        SHORT_DESCRIPTION_UZ,
        "uz",
      ).catch(() => null);
      if (!s2 || !s2.ok) warnings.push("setMyShortDescription(uz)");
    }

    // Step 2c — Mini App menu button.
    const clinic = await prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: { slug: true },
    });
    if (!clinic) return err("NotFound", 404);

    const miniAppUrl = `${origin}/c/${clinic.slug}/my`;
    if (body.setupMenuButton) {
      const r = await setChatMenuButton(body.token, {
        type: "web_app",
        text: "📅",
        web_app: { url: miniAppUrl },
      }).catch(() => null);
      if (!r || !r.ok) warnings.push("setChatMenuButton");
    }

    // Step 3 — webhook setup.
    const webhookUrl = `${origin}/api/telegram/webhook/${clinic.slug}`;
    const w = await setWebhook(body.token, {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query", "my_chat_member"],
      drop_pending_updates: true,
    }).catch(() => null);
    if (!w) return err("network_error", 502);
    if (!w.ok) {
      return err("webhook_failed", 502, { description: w.description });
    }
    // Verify the webhook came up clean.
    const info = await getWebhookInfo(body.token).catch(() => null);
    if (info && info.ok) {
      const last = info.result.last_error_date;
      if (last && Date.now() / 1000 - last < 60) {
        // Telegram already tried to reach us and failed — the user needs
        // to fix their public URL before we save anything.
        return err("webhook_unreachable", 502, {
          description: info.result.last_error_message ?? "unknown",
        });
      }
    }

    // Step 4 — persist.
    await prisma.clinic.update({
      where: { id: ctx.clinicId },
      data: {
        tgBotToken: body.token,
        tgBotUsername: me.username,
        tgWebhookSecret: webhookSecret,
      } as never,
    });

    // Step 5 — audit (token never logged; only username + meta).
    await audit(request, {
      action: "tg.connect",
      entityType: "Clinic",
      entityId: ctx.clinicId,
      meta: {
        botUsername: me.username,
        botId: me.id,
        webhookUrl,
        warnings,
      },
    });

    return ok({
      bot: {
        id: me.id,
        username: me.username,
        firstName: me.first_name,
      },
      webhookUrl,
      miniAppUrl,
      warnings,
    });
  },
);
