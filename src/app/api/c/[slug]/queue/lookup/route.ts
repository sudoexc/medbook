/**
 * POST /api/c/[slug]/queue/lookup
 *
 * Public kiosk endpoint: by phone, return today's appointments for the
 * caller so they can pick which one to check into.
 *
 * Body: { phone: string }
 * Returns: { patient | null, appointments: [...] }
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { phoneSearchVariants } from "@/lib/phone";
import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { runWithTenant } from "@/lib/tenant-context";
import { ticketNumberFor } from "@/server/services/ticket-number";

const Body = z.object({ phone: z.string().min(3).max(20) });

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return err("bad_body", 400);
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const variants = phoneSearchVariants(parsed.phone);
    if (variants.length === 0) return err("bad_phone", 400);

    const patient = await prisma.patient.findFirst({
      where: { clinicId: ctx.clinicId, phone: { in: variants } },
      select: { id: true, fullName: true, phone: true, preferredLang: true },
    });

    if (!patient) {
      return ok({ patient: null, appointments: [] });
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const appts = await prisma.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        patientId: patient.id,
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] },
      },
      select: {
        id: true,
        date: true,
        time: true,
        queueStatus: true,
        queueOrder: true,
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            specializationRu: true,
            specializationUz: true,
            photoUrl: true,
            color: true,
          },
        },
      },
      orderBy: { date: "asc" },
    });

    return ok({
      patient,
      appointments: appts.map((a) => ({
        id: a.id,
        date: a.date.toISOString(),
        time: a.time,
        queueStatus: a.queueStatus,
        queueOrder: a.queueOrder,
        ticketNumber: ticketNumberFor(a.doctor.id, a.queueOrder),
        doctor: a.doctor,
      })),
    });
  });
}
