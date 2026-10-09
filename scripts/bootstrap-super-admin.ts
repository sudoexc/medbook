/**
 * Ops: create the platform owner's SUPER_ADMIN account, or refresh one.
 *
 * Owner request 09.10.2026 (docs/design/OWNER-ACCOUNT.md §1): the owner gets
 * his own SUPER_ADMIN account under his own email, apart from any clinic's
 * admin. The script used to be hard wired to super@neurofax.uz and renamed
 * the account to «Super Admin» on every run; now:
 *
 *   --email <email>   the account (default super@neurofax.uz)
 *   --name  <name>    the name of a NEW account (default «Super Admin»).
 *                     An existing account keeps its name, always.
 *   SUPER_PASS        its password: required to create, optional to refresh
 *                     (given: replaces the password and ends the account's
 *                     sessions). At least 12 characters.
 *
 * It touches SUPER_ADMIN accounts only. An email that belongs to a clinic
 * account (ADMIN, doctor, reception) is refused, never converted
 * (scripts/_owner-account-plan.ts).
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T -e SUPER_PASS worker npx tsx scripts/bootstrap-super-admin.ts --email owner@example.uz --name "Имя Фамилия"
 * Apply:
 *   docker compose exec -T -e SUPER_PASS -e APPLY=1 worker npx tsx scripts/bootstrap-super-admin.ts --email owner@example.uz --name "Имя Фамилия"
 *
 * `-e SUPER_PASS` with no value passes the host's variable on, so the
 * password stays out of the command line (`read -rs SUPER_PASS; export
 * SUPER_PASS` first). Every write leaves a `user.create` / `user.update`
 * audit row. Idempotent: a second run without SUPER_PASS changes nothing.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import {
  DEFAULT_SUPER_ADMIN_EMAIL,
  ownerPasswordProblem,
  parseOwnerArgs,
  planBootstrap,
} from "./_owner-account-plan";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";
const TAG = "[bootstrap-super-admin]";

function usage(problem: string): never {
  console.error(`${TAG} ${problem}`);
  console.error(
    `${TAG} usage: SUPER_PASS=… npx tsx scripts/bootstrap-super-admin.ts [--email <email>] [--name <name>]`,
  );
  process.exit(2);
}

async function main() {
  const parsed = parseOwnerArgs(process.argv.slice(2));
  if (!parsed.ok) usage(parsed.error);
  const email = parsed.args.email ?? DEFAULT_SUPER_ADMIN_EMAIL;
  const name = parsed.args.name ?? null;
  const password = process.env.SUPER_PASS ?? "";
  if (password) {
    const problem = ownerPasswordProblem(password);
    if (problem) usage(`SUPER_PASS: ${problem}`);
  }

  // Staff emails are stored in lower case (audit ST-15); match any case all
  // the same, and refuse to guess between two rows.
  const matches = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      clinicId: true,
      active: true,
      mustChangePassword: true,
    },
    take: 2,
  });
  const plan = planBootstrap({ email, name, hasPassword: password !== "", matches });

  if (plan.kind === "refuse") usage(plan.reason);
  if (plan.kind === "nothing") {
    console.log(`${TAG} account: ${plan.email} (SUPER_ADMIN, active), name kept: ${plan.keptName}`);
    if (plan.nameIgnored) console.log(`${TAG} note: --name is applied to a new account only`);
    console.log(`${TAG} nothing to change.`);
    return;
  }
  if (plan.kind === "create") {
    console.log(`${TAG} will create: ${plan.email} (SUPER_ADMIN, no clinic), name: ${plan.name}`);
  } else {
    console.log(`${TAG} account: ${plan.email} (SUPER_ADMIN), name kept: ${plan.keptName}`);
    if (plan.nameIgnored) console.log(`${TAG} note: --name is applied to a new account only`);
    console.log(`${TAG} will change: ${plan.changes.join(", ")}`);
    if (plan.changes.includes("password")) {
      console.log(`${TAG} the account's open sessions will be ended`);
    }
  }
  if (!APPLY) {
    console.log(`${TAG} DRY RUN. Set APPLY=1 to write.`);
    return;
  }

  if (plan.kind === "create") {
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: plan.email,
          name: plan.name,
          role: "SUPER_ADMIN",
          clinicId: null,
          passwordHash,
          mustChangePassword: false,
        },
        select: { id: true, email: true },
      });
      await tx.auditLog.create({
        data: {
          clinicId: null,
          actorId: null,
          actorLabel: "ops:bootstrap-super-admin",
          action: "user.create",
          entityType: "User",
          entityId: created.id,
          meta: { email: created.email, role: "SUPER_ADMIN" },
        },
      });
      return created;
    });
    console.log(`${TAG} created: ${user.email} (${user.id})`);
    return;
  }

  const data: {
    passwordHash?: string;
    active?: boolean;
    mustChangePassword?: boolean;
  } = {};
  if (plan.changes.includes("password")) data.passwordHash = await hashPassword(password);
  if (plan.changes.includes("reactivate")) data.active = true;
  if (plan.changes.includes("clear_must_change_password")) data.mustChangePassword = false;
  // Never `name`: the owner's name is his to keep (design §1).
  const ended = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: plan.id }, data });
    // A new password ends the sessions opened with the old one, as
    // revokeUserSessions does in the app (its 10 s guard cache expires on
    // its own; this process does not share it).
    const sessions = plan.changes.includes("password")
      ? await tx.userSession.deleteMany({ where: { userId: plan.id } })
      : { count: 0 };
    await tx.auditLog.create({
      data: {
        clinicId: null,
        actorId: null,
        actorLabel: "ops:bootstrap-super-admin",
        action: "user.update",
        entityType: "User",
        entityId: plan.id,
        meta: { email: plan.email, changes: plan.changes, sessionsEnded: sessions.count },
      },
    });
    return sessions.count;
  });
  console.log(`${TAG} updated: ${plan.email} (${plan.changes.join(", ")}), sessions ended: ${ended}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
