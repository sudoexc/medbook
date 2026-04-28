import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

async function main() {
  const c = await prisma.clinic.findFirst({
    where: { slug: "neurofax" },
    select: { id: true },
  });
  if (!c) return;
  const rows = await prisma.notificationTemplate.findMany({
    where: { clinicId: c.id },
    select: { key: true, channel: true, isActive: true },
    take: 30,
  });
  console.log("templates:", rows.length);
  for (const r of rows)
    console.log("  -", r.key, r.channel, r.isActive ? "active" : "inactive");
  const recentSends = await prisma.notificationSend.count({
    where: { clinicId: c.id },
  });
  console.log("notification_sends total:", recentSends);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
