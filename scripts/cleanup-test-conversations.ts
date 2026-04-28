import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

async function main(): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const candidates = await prisma.conversation.findMany({
      select: {
        id: true,
        externalId: true,
        lastMessageText: true,
        contactFirstName: true,
        contactUsername: true,
        lastMessageAt: true,
      },
      orderBy: { lastMessageAt: "desc" },
    });
    console.log(`Found ${candidates.length} conversations total.\n`);
    for (const c of candidates) {
      console.log(
        `  [${c.externalId}]  fn=${c.contactFirstName ?? "-"}  u=@${c.contactUsername ?? "-"}  preview="${(c.lastMessageText ?? "").slice(0, 30)}"  ts=${c.lastMessageAt?.toISOString() ?? "-"}`,
      );
    }

    const dryRun = process.argv.includes("--dry-run");
    const args = process.argv.slice(2);
    const flagIdx = args.findIndex((a) => a === "--prefix");
    const prefix = flagIdx >= 0 ? args[flagIdx + 1] : null;
    if (!prefix) {
      console.log(
        "\nUsage: tsx scripts/cleanup-test-conversations.ts --prefix 7770 [--dry-run]",
      );
      return;
    }
    const targets = candidates.filter((c) =>
      c.externalId?.startsWith(prefix),
    );
    console.log(
      `\nMatching prefix=${prefix}: ${targets.length} conversation(s) will be deleted.`,
    );
    if (dryRun) {
      console.log("Dry-run — no changes made.");
      return;
    }
    if (targets.length === 0) return;
    const ids = targets.map((t) => t.id);
    const msgs = await prisma.message.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const convs = await prisma.conversation.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(
      `Deleted ${msgs.count} message(s) and ${convs.count} conversation(s).`,
    );
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
