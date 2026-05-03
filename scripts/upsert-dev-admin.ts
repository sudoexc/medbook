import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const clinic = await prisma.clinic.findUnique({ where: { slug: "neurofax" } });
  if (!clinic) throw new Error("neurofax clinic not found — run full seed first");

  const passwordHash = await bcrypt.hash("1", 10);
  const u = await prisma.user.upsert({
    where: { email: "1@1.uz" },
    update: {
      name: "Dev Admin (1/1)",
      passwordHash,
      role: "ADMIN",
      clinicId: clinic.id,
      active: true,
      mustChangePassword: false,
    },
    create: {
      email: "1@1.uz",
      name: "Dev Admin (1/1)",
      passwordHash,
      role: "ADMIN",
      clinicId: clinic.id,
      mustChangePassword: false,
    },
  });
  console.log(`OK: id=${u.id} email=${u.email} role=${u.role} clinicId=${u.clinicId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
