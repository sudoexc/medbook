import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});
async function main() {
  const total = await prisma.auditLog.count();
  const withCid = await prisma.auditLog.count({ where: { clinicId: { not: null } } });
  const recent = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, clinicId: true, createdAt: true } });
  console.log({ total, withCid });
  console.log("recent:", recent);
}
main().finally(() => prisma.$disconnect());
