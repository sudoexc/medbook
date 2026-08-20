/**
 * Safety interlock for the destructive demo-seed scripts.
 *
 * The seeds wipe and rebuild domain data. That was harmless while prod was a
 * pure demo, but a real doctor now runs consultations on the same database —
 * a stray seed run would delete signed conclusions, i.e. medical records.
 *
 * Two gates, both must pass:
 *   1. An explicit `--force` flag. No flag, no destruction — this alone stops
 *      an absent-minded copy-paste of a command from the runbook.
 *   2. A recent-activity probe. Real logins write AuditLog rows; the seeds do
 *      not. If the clinic has been used in the last ACTIVITY_WINDOW_HOURS the
 *      script refuses even with `--force`, unless `--i-know-there-is-real-data`
 *      is also passed. Deleting a doctor's work should take a sentence, not a
 *      keystroke.
 *
 * Usage at the top of a destructive script:
 *
 *   import { assertDestructiveAllowed } from "./_destructive-guard";
 *   await assertDestructiveAllowed(prisma, "seed-mega-neurofax");
 */
import type { PrismaClient } from "../src/generated/prisma/client";

const ACTIVITY_WINDOW_HOURS = 72;
/** Below this, the rows are almost certainly our own tooling, not clinic work. */
const ACTIVITY_ROW_THRESHOLD = 20;

export async function assertDestructiveAllowed(
  prisma: PrismaClient,
  scriptName: string,
): Promise<void> {
  const argv = process.argv.slice(2);
  const forced = argv.includes("--force");
  const acknowledged = argv.includes("--i-know-there-is-real-data");

  if (!forced) {
    console.error(
      [
        "",
        `⛔ ${scriptName} УДАЛЯЕТ данные клиники и пересобирает их заново.`,
        "",
        "   Прод neurofax сейчас используется живым врачом — запуск без",
        "   подтверждения уничтожил бы подписанные заключения (медицинские",
        "   документы).",
        "",
        "   Если это действительно то, что нужно, добавь флаг:",
        `     npx tsx scripts/${scriptName}.ts --force`,
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const since = new Date(Date.now() - ACTIVITY_WINDOW_HOURS * 3600_000);
  // Counted across the whole DB on purpose: the seeds are clinic-scoped, but
  // the question here is "is anyone actually working in this deployment".
  const recentAudit = await prisma.auditLog.count({
    where: { createdAt: { gte: since } },
  });

  if (recentAudit >= ACTIVITY_ROW_THRESHOLD && !acknowledged) {
    console.error(
      [
        "",
        `⛔ Отказ: за последние ${ACTIVITY_WINDOW_HOURS} ч в системе ${recentAudit} действий`,
        "   пользователей — похоже, ей уже пользуются по-настоящему.",
        "",
        "   Сначала сделай бэкап:",
        "     cd /opt/neurofax && ./ops/backup.sh",
        "",
        "   И только если точно уверен, что демо-данные важнее реальных:",
        `     npx tsx scripts/${scriptName}.ts --force --i-know-there-is-real-data`,
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (recentAudit >= ACTIVITY_ROW_THRESHOLD) {
    console.warn(
      `⚠️  ${recentAudit} действий пользователей за ${ACTIVITY_WINDOW_HOURS} ч — стираю по явному подтверждению.\n`,
    );
  }
}
