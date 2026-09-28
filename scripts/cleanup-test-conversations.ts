/**
 * Delete test Telegram conversations (and their messages) of ONE clinic whose
 * chat id starts with a prefix, e.g. the fake 7770… ids of a local bot test.
 *
 *   CLINIC_SLUG=<slug> npx tsx scripts/cleanup-test-conversations.ts
 *       → lists the clinic's conversations
 *   CLINIC_SLUG=<slug> npx tsx scripts/cleanup-test-conversations.ts --prefix 7770 --dry-run
 *   CLINIC_SLUG=<slug> npx tsx scripts/cleanup-test-conversations.ts --prefix 7770 --force
 *
 * Audit G2-05: it used to walk every clinic of the database and delete by
 * prefix alone, with no guard. A short or mistyped prefix on production takes
 * real patients' chats with it, and messages are not recoverable. Now it is
 * scoped to one named clinic and goes through the destructive-seed guard
 * before deleting: never with NODE_ENV=production, never on a clinic with
 * signed conclusions, and only with --force.
 */
import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { assertSeedAllowed, requireClinicSlug } from "./_destructive-guard";

const SCRIPT = "cleanup-test-conversations";

async function main(): Promise<void> {
  const slug = requireClinicSlug(SCRIPT);
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const clinic = await prisma.clinic.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!clinic) {
      console.error(`⛔ ${SCRIPT}: клиника «${slug}» не найдена.`);
      process.exitCode = 1;
      return;
    }
    const candidates = await prisma.conversation.findMany({
      where: { clinicId: clinic.id },
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
    console.log(`Found ${candidates.length} conversations in ${slug}.\n`);
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
        `\nUsage: CLINIC_SLUG=<slug> tsx scripts/${SCRIPT}.ts --prefix 7770 [--dry-run]`,
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
    // Before the first write: the interlock every script that deletes
    // clinic data goes through.
    await assertSeedAllowed(prisma, {
      script: SCRIPT,
      clinicSlug: slug,
      destructive: true,
    });
    const ids = targets.map((t) => t.id);
    const msgs = await prisma.message.deleteMany({
      where: { conversationId: { in: ids } },
    });
    const convs = await prisma.conversation.deleteMany({
      where: { id: { in: ids }, clinicId: clinic.id },
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
