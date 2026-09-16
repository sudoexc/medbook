/**
 * Connect a clinic's Telegram bot from the ops side — the same steps as the
 * CRM wizard (`/api/crm/integrations/tg/connect`), with an explicit public
 * origin.
 *
 * Why it exists: the wizard derives the webhook origin from
 * `NEXT_PUBLIC_APP_URL`, and that var is inlined at BUILD time. On a prod
 * image built without it the wizard falls back to the container origin
 * (`https://0.0.0.0:3000`) and Telegram rejects the webhook — while steps 1–2
 * (commands, menu button) have already run, the menu button now pointing at
 * the same broken origin. This script redoes every step with the real URL.
 *
 * Usage (worker container, repo mounted or baked):
 *   TG_TOKEN=123:ABC APP_URL=https://neurofax.uz CLINIC_SLUG=neurofax \
 *     npx tsx scripts/connect-tg-bot.ts
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  getMe,
  getWebhookInfo,
  setChatMenuButton,
  setMyCommands,
  setWebhook,
} from "../src/server/telegram/bot-api";

// Same payloads as the CRM wizard — keep in step with
// src/app/api/crm/integrations/tg/connect/route.ts.
const COMMANDS_RU = [
  { command: "start", description: "Начать" },
  { command: "booking", description: "Записаться на приём" },
  { command: "cancel", description: "Отменить запись" },
  { command: "help", description: "Помощь" },
];
const COMMANDS_UZ = [
  { command: "start", description: "Boshlash" },
  { command: "booking", description: "Qabulga yozilish" },
  { command: "cancel", description: "Yozilishni bekor qilish" },
  { command: "help", description: "Yordam" },
];
import { writeTgBotToken } from "../src/server/crypto/secret-fields";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const token = process.env.TG_TOKEN?.trim();
  const appUrl = process.env.APP_URL?.trim()?.replace(/\/$/, "");
  const slug = process.env.CLINIC_SLUG?.trim();
  if (!token || !appUrl || !slug) {
    throw new Error("TG_TOKEN, APP_URL and CLINIC_SLUG are required");
  }
  if (!appUrl.startsWith("https://")) {
    throw new Error("APP_URL must be https — Telegram refuses plain http");
  }

  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: { id: true, slug: true, tgBotUsername: true },
  });
  if (!clinic) throw new Error(`clinic '${slug}' not found`);

  const me = await getMe(token);
  if (!me.ok) throw new Error(`getMe failed: ${me.description}`);
  console.log(`bot: @${me.result.username} (${me.result.first_name})`);

  // Commands + menu button — same payloads as the wizard, correct origin.
  const miniAppUrl = `${appUrl}/c/${clinic.slug}/my`;
  const c1 = await setMyCommands(token, COMMANDS_RU, "ru");
  const c2 = await setMyCommands(token, COMMANDS_UZ, "uz");
  const c3 = await setMyCommands(token, COMMANDS_RU);
  const mb = await setChatMenuButton(token, {
    type: "web_app",
    text: "📅",
    web_app: { url: miniAppUrl },
  });
  console.log(
    `commands ru:${c1.ok} uz:${c2.ok} default:${c3.ok} · menu button:${mb.ok} → ${miniAppUrl}`,
  );

  const webhookSecret = randomBytes(24).toString("hex");
  const webhookUrl = `${appUrl}/api/telegram/webhook/${clinic.slug}`;
  const w = await setWebhook(token, {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: true,
  });
  if (!w.ok) {
    throw new Error(`setWebhook failed: ${w.description ?? w.error_code}`);
  }
  const info = await getWebhookInfo(token);
  console.log(
    `webhook: ${webhookUrl} · pending=${info.ok ? info.result.pending_update_count : "?"}`,
  );

  await prisma.clinic.update({
    where: { id: clinic.id },
    data: {
      tgBotToken: writeTgBotToken(token),
      tgBotUsername: me.result.username,
      tgWebhookSecret: webhookSecret,
    } as never,
  });
  console.log(
    `saved: @${me.result.username} replaces ${clinic.tgBotUsername ?? "—"} on clinic '${clinic.slug}'`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("✗", e.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
