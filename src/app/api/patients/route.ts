import { auth } from "@/lib/auth";
import { isAuthorizedOrPin } from "@/lib/auth-or-pin";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/patients?search=
export async function GET(request: Request) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";

  if (!search || search.length < 2) {
    return Response.json([]);
  }

  const patients = await prisma.patient.findMany({
    where: {
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { passport: { contains: search, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      passport: true,
      birthDate: true,
    },
    take: 20,
    orderBy: { updatedAt: "desc" },
  });

  return Response.json(patients);
}

const CreateSchema = z.object({
  fullName: z.string().min(2).max(200),
  phone: z.string().min(9).max(20),
  passport: z.string().max(20).optional(),
  birthDate: z.string().optional(),
});

// POST /api/patients — create or find by phone
export async function POST(request: Request) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { fullName, phone, passport, birthDate } = parsed.data;

  const patient = await prisma.patient.upsert({
    where: { phone },
    update: { fullName, passport: passport || undefined, birthDate: birthDate ? new Date(birthDate) : undefined },
    create: { fullName, phone, passport: passport || undefined, birthDate: birthDate ? new Date(birthDate) : undefined },
    select: { id: true, fullName: true, phone: true, passport: true, birthDate: true },
  });

  return Response.json(patient, { status: 201 });
}
