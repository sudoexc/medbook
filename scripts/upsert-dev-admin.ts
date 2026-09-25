/**
 * Create (or re-activate) the local dev shortcut admin 1@1.uz.
 *
 * Audit SEC-04: its password used to be the literal «1», and this script
 * would happily run against production. Now the password comes from
 * DEV_ADMIN_PASSWORD (or SEED_PASSWORD) in your local .env, or is generated
 * and printed once; an existing account keeps its password unless
 * DEV_ADMIN_PASSWORD is set explicitly for this run. On NODE_ENV=production
 * it refuses to run without SEED_ALLOW_PROD_ACCOUNTS=1.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  assertAccountSeedAllowed,
  printIssuedPasswords,
  upsertSeedUser,
} from "./_seed-passwords";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const EMAIL = "1@1.uz";

async function main() {
  assertAccountSeedAllowed("scripts/upsert-dev-admin.ts");

  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("neurofax clinic not found — run full seed first");

  const base = {
    name: "Dev Admin",
    role: "ADMIN" as const,
    clinicId: clinic.id,
    active: true,
  };
  // Resetting an existing account's password is an explicit, per-run choice.
  const explicit = process.env.DEV_ADMIN_PASSWORD;

  const u = await upsertSeedUser({
    email: EMAIL,
    envVar: "DEV_ADMIN_PASSWORD",
    exists: async () =>
      Boolean(await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })),
    create: (pw) =>
      prisma.user.create({
        data: {
          email: EMAIL,
          ...base,
          passwordHash: pw.hash,
          mustChangePassword: pw.mustChangePassword,
        },
      }),
    update: async () =>
      prisma.user.update({
        where: { email: EMAIL },
        data: explicit
          ? { ...base, passwordHash: await bcrypt.hash(explicit, 10) }
          : base,
      }),
  });
  console.log(`OK: id=${u.id} email=${u.email} role=${u.role} clinicId=${u.clinicId}`);
  printIssuedPasswords();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
