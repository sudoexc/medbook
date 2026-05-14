/**
 * /api/crm/doctors/me/patients/[patientId]/summary — focused payload for the
 * messages context rail (Phase 2.4). Returns a single shape so the client
 * doesn't fan out across patient/allergies/chronic/documents endpoints.
 *
 * Anti-leak: confirms the patient is in the doctor's clinic AND has at least
 * one appointment with the calling doctor — same shape as the visits route.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound } from "@/server/http";

type SummaryResponse = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string | null;
  birthDate: string | null;
  segment: string | null;
  allergies: Array<{ id: string; substance: string; severity: string }>;
  chronicConditions: Array<{ id: string; name: string }>;
  upcomingAppointment: {
    id: string;
    date: string;
    status: string;
    doctor: { id: string; nameRu: string | null; nameUz: string | null } | null;
  } | null;
  lastDocument: {
    id: string;
    title: string;
    type: string;
    createdAt: string;
  } | null;
};

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("summary");
  if (idx <= 0) return "";
  return parts[idx - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const patientId = patientIdFromUrl(request);
    if (!patientId) {
      return err("BadRequest", 400, { reason: "missing_patient_id" });
    }

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return err("Forbidden", 403, { reason: "not_a_doctor" });

    const patient = await prisma.patient.findFirst({
      where: { id: patientId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        phoneNormalized: true,
        birthDate: true,
        segment: true,
      },
    });
    if (!patient) return notFound();

    // Anti-leak: caller must have had at least one appointment with this
    // patient. If not, behave as if the row doesn't exist.
    const relation = await prisma.appointment.findFirst({
      where: { patientId: patient.id, doctorId: doctor.id },
      select: { id: true },
    });
    if (!relation) return notFound();

    const [allergies, chronicConditions, upcoming, lastDoc] = await Promise.all([
      prisma.patientAllergy.findMany({
        where: { patientId: patient.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, substance: true, severity: true },
      }),
      prisma.patientChronicCondition.findMany({
        where: { patientId: patient.id, isActive: true },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      }),
      prisma.appointment.findFirst({
        where: {
          patientId: patient.id,
          doctorId: doctor.id,
          status: { in: ["BOOKED", "WAITING", "IN_PROGRESS"] },
          date: { gte: new Date(Date.now() - 60 * 60_000) },
        },
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          status: true,
          doctor: { select: { id: true, nameRu: true, nameUz: true } },
        },
      }),
      prisma.document.findFirst({
        where: {
          patientId: patient.id,
          OR: [
            { appointment: { doctorId: doctor.id } },
            { patient: { appointments: { some: { doctorId: doctor.id } } } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, type: true, createdAt: true },
      }),
    ]);

    const response: SummaryResponse = {
      id: patient.id,
      fullName: patient.fullName,
      phone: patient.phone,
      phoneNormalized: patient.phoneNormalized,
      birthDate: patient.birthDate
        ? patient.birthDate.toISOString()
        : null,
      segment: patient.segment ?? null,
      allergies: allergies.map((a) => ({
        id: a.id,
        substance: a.substance,
        severity: a.severity,
      })),
      chronicConditions: chronicConditions.map((c) => ({
        id: c.id,
        name: c.name,
      })),
      upcomingAppointment: upcoming
        ? {
            id: upcoming.id,
            date: upcoming.date.toISOString(),
            status: upcoming.status,
            doctor: upcoming.doctor,
          }
        : null,
      lastDocument: lastDoc
        ? {
            id: lastDoc.id,
            title: lastDoc.title,
            type: lastDoc.type,
            createdAt: lastDoc.createdAt.toISOString(),
          }
        : null,
    };
    return ok(response);
  },
);
