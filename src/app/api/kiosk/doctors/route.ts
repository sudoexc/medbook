import { prisma } from "@/lib/prisma";

// GET /api/kiosk/doctors — public, returns active doctors with services for kiosk
export async function GET() {
  const doctors = await prisma.doctor.findMany({
    where: { active: true },
    orderBy: { cabinet: "asc" },
    select: {
      id: true,
      nameRu: true,
      nameUz: true,
      cabinet: true,
      services: true,
    },
  });

  return Response.json(
    doctors.map((d) => ({
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz,
      cabinet: d.cabinet,
      services: (d.services as { nameRu: string; nameUz: string; price: number }[]) || [],
    }))
  );
}
