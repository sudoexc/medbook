import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });
  const pass = process.env.SUPER_PASS;
  if (!pass) throw new Error('SUPER_PASS env required');
  const hash = await bcrypt.hash(pass, 10);
  const u = await prisma.user.upsert({
    where: { email: 'super@neurofax.uz' },
    update: { role: 'SUPER_ADMIN', name: 'Super Admin', passwordHash: hash, active: true, mustChangePassword: false },
    create: { email: 'super@neurofax.uz', role: 'SUPER_ADMIN', name: 'Super Admin', passwordHash: hash, mustChangePassword: false },
  });
  console.log('OK', u.id, u.email);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
