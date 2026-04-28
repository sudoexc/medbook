import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

async function main() {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const c = await prisma.clinic.findUnique({
      where: { slug: "neurofax" },
      select: { tgWebhookSecret: true },
    });
    if (!c?.tgWebhookSecret) { console.log("no secret"); return; }
    const url = "https://arrangements-mike-dose-allow.trycloudflare.com/api/telegram/webhook/neurofax";
    const fake = {
      update_id: 999999999,
      message: {
        message_id: 9999,
        chat: { id: 200479724, type: "private" },
        from: { id: 200479724, first_name: "Joe", last_name: "Test", username: "joe_test" },
        text: "йоу test",
        date: Math.floor(Date.now() / 1000),
      },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": c.tgWebhookSecret,
      },
      body: JSON.stringify(fake),
    });
    console.log("status", res.status, await res.text());
  });
}
main().finally(() => prisma.$disconnect());
