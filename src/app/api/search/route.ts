import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  if (q.length < 2) return Response.json({ patients: [], leads: [] });

  const [patients, leads] = await Promise.all([
    prisma.patient.findMany({
      where: {
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { passport: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, fullName: true, phone: true },
      take: 5,
    }),
    prisma.lead.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      select: { id: true, name: true, phone: true, status: true },
      take: 5,
    }),
  ]);

  return Response.json({ patients, leads });
}
