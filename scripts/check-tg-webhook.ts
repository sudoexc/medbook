import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

async function main() {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const clinics = await prisma.clinic.findMany({
      select: {
        id: true,
        slug: true,
        nameRu: true,
        tgBotToken: true,
        tgBotUsername: true,
        tgWebhookSecret: true,
      },
    });
    for (const c of clinics) {
      console.log(`\n[${c.slug}] ${c.nameRu}`);
      console.log(`  bot username: ${c.tgBotUsername ?? "(empty)"}`);
      console.log(`  bot token:    ${c.tgBotToken ? c.tgBotToken.slice(0, 10) + "…" : "(empty)"}`);
      console.log(`  webhook secret: ${c.tgWebhookSecret ? "SET" : "(empty)"}`);
      if (c.tgBotToken) {
        const r = await fetch(
          `https://api.telegram.org/bot${c.tgBotToken}/getWebhookInfo`,
        );
        const j = (await r.json()) as { ok: boolean; result?: Record<string, unknown> };
        console.log(`  getWebhookInfo:`, JSON.stringify(j.result, null, 2));
      }
    }
  });
}
main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
