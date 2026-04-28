import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });
async function main() {
  const c = await prisma.clinic.findFirst({ where: { slug: "neurofax" }, select: { id: true } });
  if (!c) return;
  const users = await prisma.user.findMany({
    where: { clinicId: c.id },
    select: { email: true, role: true, active: true },
  });
  for (const u of users) console.log(u.role, u.active ? "active" : "inactive", "→", u.email);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
