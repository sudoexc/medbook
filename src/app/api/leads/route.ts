import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { sendNewLeadEmail } from "@/lib/email";
import { z } from "zod";

const LeadSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(9).max(20),
  doctorId: z.string().max(50).optional(),
  service: z.string().max(100).optional(),
  date: z.string().max(10).optional(),
  locale: z.enum(["ru", "uz"]).default("ru"),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("countNew") === "true") {
    const count = await prisma.lead.count({ where: { status: "NEW" } });
    return Response.json({ count });
  }
  return Response.json({ error: "Bad request" }, { status: 400 });
}

export async function POST(request: Request) {
  // Rate limit: 10 submissions per minute per IP
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimit(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = LeadSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const lead = await prisma.lead.create({ data: parsed.data });

    // Send email notification to doctor (fire-and-forget)
    if (lead.doctorId) {
      const doctor = await prisma.doctor.findUnique({
        where: { id: lead.doctorId },
        include: { user: { select: { email: true } } },
      });
      if (doctor?.user?.email) {
        sendNewLeadEmail({
          doctorEmail: doctor.user.email,
          doctorName: doctor.nameRu,
          patientName: lead.name,
          patientPhone: lead.phone,
          service: lead.service || undefined,
          date: lead.date || undefined,
        }).catch(() => {}); // don't fail the request if email fails
      }
    }

    return Response.json({ success: true, id: lead.id }, { status: 201 });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
