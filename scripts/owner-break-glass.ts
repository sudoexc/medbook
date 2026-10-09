/**
 * Ops: the platform owner lost access («Потерял доступ владельца»,
 * docs/operations/RUNBOOK.md §3.8). Owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §1 and §5.
 *
 * For one SUPER_ADMIN account, in one transaction:
 *   - a new password: NEW_PASSWORD (at least 12 characters, kept as his
 *     own), or a generated one printed ONCE and to be changed at the first
 *     sign-in;
 *   - 2FA wiped (the same columns as «Сбросить 2FA», TOTP_RESET_DATA), so
 *     the password alone lets him in;
 *   - the account switched back on if it was deactivated;
 *   - every session ended (what revokeUserSessions does; the app's 10 s
 *     guard cache expires on its own);
 *   - every live clinic visit closed (`endedReason: "revoked"`, one
 *     SUPER_ADMIN_IMPERSONATE_ENDED row each with `via: "break_glass"`);
 *   - a PLATFORM_BREAK_GLASS audit row.
 *
 * SUPER_ADMIN accounts only: a clinic account is refused (its password comes
 * from the clinic's admin or the /admin console). Server only, there is no
 * web path to this.
 *
 * Dry run (default, writes nothing):
 *   docker compose run --rm -T -v /opt/neurofax/scripts:/app/scripts worker npx tsx scripts/owner-break-glass.ts --email owner@example.uz
 * Apply, generated password:
 *   docker compose run --rm -T -v /opt/neurofax/scripts:/app/scripts -e APPLY=1 worker npx tsx scripts/owner-break-glass.ts --email owner@example.uz
 * Apply, own password (`read -rs NEW_PASSWORD; export NEW_PASSWORD` first,
 * so it stays out of the shell history):
 *   docker compose run --rm -T -v /opt/neurofax/scripts:/app/scripts -e APPLY=1 -e NEW_PASSWORD worker npx tsx scripts/owner-break-glass.ts --email owner@example.uz
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { AUDIT_ACTION } from "../src/lib/audit-actions";
import { generateTempPassword, hashPassword } from "../src/server/auth/password";
import { TOTP_RESET_DATA } from "../src/server/auth/totp-reset";
import {
  GENERATED_PASSWORD_LENGTH,
  PLATFORM_BREAK_GLASS_ACTION,
  parseOwnerArgs,
  planBreakGlass,
} from "./_owner-account-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const TAG = "[owner-break-glass]";
const ACTOR_LABEL = "ops:owner-break-glass";

function usage(problem: string): never {
  console.error(`${TAG} ${problem}`);
  console.error(
    `${TAG} usage: [NEW_PASSWORD=…] npx tsx scripts/owner-break-glass.ts --email <owner email>`,
  );
  process.exit(2);
}

async function main() {
  const parsed = parseOwnerArgs(process.argv.slice(2));
  if (!parsed.ok) usage(parsed.error);
  if (parsed.args.name !== undefined) usage("--name does not apply here");
  // No default account: resetting the wrong one would lock its owner out.
  const email = parsed.args.email;
  if (!email) usage("--email is required");

  const rows = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      clinicId: true,
      active: true,
      mustChangePassword: true,
      totpEnabledAt: true,
    },
    take: 2,
  });
  const plan = planBreakGlass({
    email,
    matches: rows.map(({ totpEnabledAt, ...r }) => ({
      ...r,
      totpEnabled: totpEnabledAt !== null,
    })),
    newPassword: process.env.NEW_PASSWORD,
  });
  if (plan.kind === "refuse") usage(plan.reason);
  const target = plan.target;

  const now = new Date();
  const [sessionCount, liveGrants] = await Promise.all([
    prisma.userSession.count({ where: { userId: target.id } }),
    // A lapsed lease is the expiry sweep's to close (as "expired"); only the
    // ones still running are cut short here.
    prisma.impersonationGrant.findMany({
      where: { superAdminId: target.id, endedAt: null, expiresAt: { gt: now } },
      select: { id: true, clinicId: true, startedAt: true },
    }),
  ]);

  console.log(`${TAG} account: ${target.email} (SUPER_ADMIN), name: ${target.name}`);
  console.log(`${TAG} active: ${target.active ? "yes" : "NO, will be switched back on"}`);
  console.log(`${TAG} 2FA: ${target.totpEnabled ? "enrolled, will be wiped" : "not enrolled"}`);
  console.log(
    `${TAG} password: ${
      plan.passwordSource === "env"
        ? "from NEW_PASSWORD, kept as his own"
        : "generated, printed once, must be changed at the first sign-in"
    }`,
  );
  console.log(`${TAG} sessions to end: ${sessionCount}`);
  console.log(`${TAG} live clinic visits to close: ${liveGrants.length}`);
  if (!APPLY) {
    console.log(`${TAG} DRY RUN. Set APPLY=1 to write.`);
    return;
  }

  const password =
    plan.passwordSource === "env"
      ? process.env.NEW_PASSWORD!
      : generateTempPassword(GENERATED_PASSWORD_LENGTH);
  const passwordHash = await hashPassword(password);
  const grantIds = liveGrants.map((g) => g.id);

  const result = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        passwordHash,
        mustChangePassword: plan.mustChangePassword,
        ...(plan.reactivate ? { active: true } : {}),
        ...TOTP_RESET_DATA,
      },
    });
    const sessions = await tx.userSession.deleteMany({ where: { userId: target.id } });
    const closed = grantIds.length
      ? await tx.impersonationGrant.updateMany({
          where: { id: { in: grantIds }, endedAt: null },
          data: { endedAt: now, endedReason: "revoked" },
        })
      : { count: 0 };
    for (const g of liveGrants) {
      await tx.auditLog.create({
        data: {
          clinicId: g.clinicId,
          actorId: null,
          actorLabel: ACTOR_LABEL,
          action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_ENDED,
          entityType: "ImpersonationGrant",
          entityId: g.id,
          meta: {
            clinicId: g.clinicId,
            durationMs: now.getTime() - g.startedAt.getTime(),
            via: "break_glass",
          },
        },
      });
    }
    await tx.auditLog.create({
      data: {
        clinicId: null,
        actorId: null,
        actorLabel: ACTOR_LABEL,
        action: PLATFORM_BREAK_GLASS_ACTION,
        entityType: "User",
        entityId: target.id,
        meta: {
          email: target.email,
          passwordSource: plan.passwordSource,
          mustChangePassword: plan.mustChangePassword,
          totpCleared: target.totpEnabled,
          reactivated: plan.reactivate,
          sessionsEnded: sessions.count,
          grantsEnded: grantIds,
        },
      },
    });
    return { sessions: sessions.count, grants: closed.count };
  });

  console.log(
    `${TAG} done: sessions ended ${result.sessions}, clinic visits closed ${result.grants}`,
  );
  if (plan.passwordSource === "generated") {
    console.log(`${TAG} new password (shown once, change it at the first sign-in):`);
    console.log(`  ${password}`);
  } else {
    console.log(`${TAG} the password is the one in NEW_PASSWORD`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
