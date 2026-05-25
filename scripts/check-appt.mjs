import { PrismaClient } from '../src/generated/prisma/client.js';
const prisma = new PrismaClient();
const a = await prisma.appointment.findUnique({
  where: { id: 'cmpfffgp101c611x8hure1tow' },
  select: { id: true, status: true, queueStatus: true, clinicId: true, doctorId: true, date: true, patientId: true },
});
console.log(JSON.stringify(a, null, 2));
await prisma.$disconnect();
