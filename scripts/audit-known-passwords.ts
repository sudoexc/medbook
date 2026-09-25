/**
 * Ops check: no active staff account may still use a password that shipped
 * in this repository's seeds (audit SEC-04).
 *
 * The seeds used to set super@neurofax.uz / «super», admin@ / «admin»,
 * recept@ / «recept», 1@1.uz / «1», every seeded doctor (including the seven
 * real NeuroFax doctors from seed-neurofax-real.ts) / «doctor», and the
 * guard-e2e doctor / «Guard12345». This script compares every ACTIVE user's
 * password hash against that list.
 *
 *   DRY RUN (default) — lists the matching accounts, changes nothing:
 *     npx tsx scripts/audit-known-passwords.ts
 *
 *   APPLY=1 — for each match: sets a fresh random temporary password, forces
 *   a password change at next sign-in, ends all of that user's sessions, and
 *   prints the temporary passwords ONCE so the clinic admin can hand them
 *   out. The affected people cannot sign in with the old password any more,
 *   so run it when someone is there to pass the new ones on:
 *     APPLY=1 npx tsx scripts/audit-known-passwords.ts
 *
 *   EXTRA_PASSWORDS="a,b" adds more candidates to check.
 *
 * Idempotent: once nobody matches, APPLY=1 changes nothing. Acceptance: the
 * dry run reports 0 matches.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { generateTempPassword } from "../src/server/auth/password";

const KNOWN = ["super", "admin", "doctor", "recept", "operator", "1", "Guard12345"];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const apply = process.env.APPLY === "1";
  const candidates = [
    ...KNOWN,
    ...(process.env.EXTRA_PASSWORDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];

  const users = await prisma.user.findMany({
    where: { active: true, passwordHash: { not: null } },
    select: { id: true, email: true, role: true, clinicId: true, passwordHash: true },
    orderBy: { email: "asc" },
  });
  console.log(
    `${apply ? "APPLY" : "DRY RUN"}: checking ${users.length} active accounts against ${candidates.length} known passwords…`,
  );

  const matches: Array<{ id: string; email: string; role: string; clinicId: string | null }> = [];
  for (const u of users) {
    for (const pw of candidates) {
      if (await bcrypt.compare(pw, u.passwordHash!)) {
        matches.push({ id: u.id, email: u.email, role: u.role, clinicId: u.clinicId });
        break;
      }
    }
  }

  if (matches.length === 0) {
    console.log("OK: no active account uses a known seed password.");
    return;
  }

  console.log(`\nFOUND ${matches.length} account(s) with a known password:`);
  for (const m of matches) console.log(`  ${m.email.padEnd(32)} ${m.role}`);

  if (!apply) {
    console.log("\nNothing changed. Re-run with APPLY=1 to reset them.");
    process.exitCode = 2;
    return;
  }

  console.log("\nNew temporary passwords (shown once, must be changed at sign-in):");
  for (const m of matches) {
    const temp = generateTempPassword(14);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: m.id },
        data: { passwordHash: await bcrypt.hash(temp, 10), mustChangePassword: true },
      }),
      prisma.userSession.deleteMany({ where: { userId: m.id } }),
      prisma.auditLog.create({
        data: {
          clinicId: m.clinicId,
          actorId: null,
          actorLabel: "ops:audit-known-passwords",
          action: "user.reset_password",
          entityType: "User",
          entityId: m.id,
          meta: { reason: "known_seed_password" },
        },
      }),
    ]);
    console.log(`  ${m.email.padEnd(32)} ${temp}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
