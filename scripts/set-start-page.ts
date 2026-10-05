/**
 * Ops: set or clear a staff account's start page (owner request 05.10.2026,
 * see src/lib/start-page.ts). The clinic's iPad reception account opens
 * straight into the tablet page with:
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/set-start-page.ts reception-ipad@neurofax.uz reception-tablet
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/set-start-page.ts reception-ipad@neurofax.uz reception-tablet
 * Back to the role's usual home:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/set-start-page.ts reception-ipad@neurofax.uz none
 *
 * The same setting is in the CRM: «Настройки → Пользователи → Изменить →
 * Стартовая страница». Values: `reception-tablet` (RECEPTIONIST accounts
 * only) or `none`. Open sessions pick the change up on their next request
 * (the session guard re-reads the account), no re-login needed.
 *
 * Idempotent: a second run reports nothing to change. Every write leaves a
 * `user.update` audit row.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  START_PAGES,
  parseStartPage,
  startPageAllowedFor,
  type StartPage,
} from "../src/lib/start-page";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const CLEAR_WORDS = new Set(["none", "default", "null", "off"]);

function usage(problem: string): never {
  console.error(`[start-page] ${problem}`);
  console.error(
    `[start-page] usage: npx tsx scripts/set-start-page.ts <email> <${START_PAGES.join("|")}|none>`,
  );
  process.exit(2);
}

async function main() {
  const [emailArg, valueArg] = process.argv.slice(2);
  if (!emailArg || !valueArg) usage("an email and a value are required");
  const email = emailArg.trim().toLowerCase();
  const raw = valueArg.trim().toLowerCase();
  let wanted: StartPage | null;
  if (CLEAR_WORDS.has(raw)) {
    wanted = null;
  } else {
    wanted = parseStartPage(raw);
    if (!wanted) usage(`unknown start page «${valueArg}»`);
  }

  // Staff emails are stored in lower case (audit ST-15); match any case all
  // the same, and refuse to guess between two rows.
  const users = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      clinicId: true,
      startPage: true,
      clinic: { select: { nameRu: true } },
    },
    take: 2,
  });
  if (users.length === 0) usage(`no account with the email ${email}`);
  if (users.length > 1) usage(`more than one account matches ${email}, fix the emails first`);
  const user = users[0]!;

  console.log(`[start-page] account: ${user.email} (${user.role}), clinic: ${user.clinic?.nameRu ?? "none"}`);
  if (!user.active) console.log("[start-page] note: the account is deactivated");
  console.log(`[start-page] start page now: ${user.startPage ?? "none"}`);
  console.log(`[start-page] start page wanted: ${wanted ?? "none"}`);

  if (wanted && !startPageAllowedFor(user.role, wanted)) {
    usage(`${wanted} applies to RECEPTIONIST accounts only, this one is ${user.role}`);
  }
  if ((user.startPage ?? null) === wanted) {
    console.log("[start-page] nothing to change.");
    return;
  }
  if (!APPLY) {
    console.log("[start-page] DRY RUN. Set APPLY=1 to write.");
    return;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { startPage: wanted },
    }),
    prisma.auditLog.create({
      data: {
        clinicId: user.clinicId,
        actorId: null,
        actorLabel: "ops:set-start-page",
        action: "user.update",
        entityType: "User",
        entityId: user.id,
        meta: {
          before: { startPage: user.startPage ?? null },
          after: { startPage: wanted },
        },
      },
    }),
  ]);
  console.log(`[start-page] updated: ${user.email} → ${wanted ?? "none"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
