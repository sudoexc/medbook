/**
 * Re-register the Telegram webhook URL for a clinic. Run after restarting
 * the cloudflared tunnel (the dev URL changes every time):
 *
 *   tsx scripts/set-tg-webhook.ts <clinic-slug> <https-base-url>
 *
 * Example:
 *   tsx scripts/set-tg-webhook.ts neurofax https://abc-123.trycloudflare.com
 *
 * The script also prints `getWebhookInfo` after the update so you can
 * verify the URL is reachable.
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

async function main(): Promise<void> {
  const [, , slug, baseUrl] = process.argv;
  if (!slug || !baseUrl) {
    console.error(
      "Usage: tsx scripts/set-tg-webhook.ts <clinic-slug> <https-base-url>",
    );
    process.exit(1);
  }
  if (!baseUrl.startsWith("https://")) {
    console.error("Base URL must start with https:// (Telegram requirement).");
    process.exit(1);
  }

  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const clinic = await prisma.clinic.findUnique({
      where: { slug },
      select: { tgBotToken: true, tgWebhookSecret: true },
    });
    if (!clinic?.tgBotToken || !clinic.tgWebhookSecret) {
      console.error(`Clinic '${slug}' has no bot token or webhook secret.`);
      process.exit(1);
    }
    const url = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook/${slug}`;
    const setRes = await fetch(
      `https://api.telegram.org/bot${clinic.tgBotToken}/setWebhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: clinic.tgWebhookSecret,
          allowed_updates: ["message", "callback_query", "my_chat_member"],
          drop_pending_updates: false,
        }),
      },
    );
    const setJson = await setRes.json();
    console.log("setWebhook →", setJson);

    const infoRes = await fetch(
      `https://api.telegram.org/bot${clinic.tgBotToken}/getWebhookInfo`,
    );
    const infoJson = await infoRes.json();
    console.log("\ngetWebhookInfo →", JSON.stringify(infoJson.result, null, 2));
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
