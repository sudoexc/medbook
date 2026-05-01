/**
 * /api/crm/search — cross-entity global search (patients / doctors /
 * appointments / conversations). Returns up to 5 per category.
 * See docs/TZ.md §6.0 top-bar search.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const u = new URL(request.url);
    const q = (u.searchParams.get("q") ?? "").trim();
    if (!q) {
      return ok({
        patients: [],
        doctors: [],
        appointments: [],
        conversations: [],
      });
    }

    const phoneDigits = q.replace(/\D/g, "");
    const phoneNorm = normalizePhone(q);
    const patientPhoneOr: Array<Record<string, unknown>> = [
      { phone: { contains: q } },
    ];
    if (phoneDigits.length >= 3) {
      patientPhoneOr.push({ phoneNormalized: { contains: phoneDigits } });
      if (phoneNorm) patientPhoneOr.push({ phoneNormalized: { contains: phoneNorm } });
    }
    const apptPatientPhoneOr: Array<Record<string, unknown>> = [
      { patient: { phone: { contains: q } } },
    ];
    if (phoneDigits.length >= 3) {
      apptPatientPhoneOr.push({
        patient: { phoneNormalized: { contains: phoneDigits } },
      });
      if (phoneNorm) {
        apptPatientPhoneOr.push({
          patient: { phoneNormalized: { contains: phoneNorm } },
        });
      }
    }

    const [patients, doctors, appointments, conversations] = await Promise.all([
      prisma.patient.findMany({
        where: {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            ...patientPhoneOr,
          ],
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          photoUrl: true,
          balance: true,
        },
        take: 5,
      }),
      prisma.doctor.findMany({
        where: {
          isActive: true,
          OR: [
            { nameRu: { contains: q, mode: "insensitive" } },
            { nameUz: { contains: q, mode: "insensitive" } },
            { specializationRu: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          nameRu: true,
          nameUz: true,
          photoUrl: true,
          specializationRu: true,
          color: true,
        },
        take: 5,
      }),
      prisma.appointment.findMany({
        where: {
          OR: [
            { patient: { fullName: { contains: q, mode: "insensitive" } } },
            ...apptPatientPhoneOr,
            { notes: { contains: q, mode: "insensitive" } },
            { comments: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { date: "desc" },
        select: {
          id: true,
          date: true,
          status: true,
          patient: { select: { id: true, fullName: true, phone: true } },
          doctor: { select: { id: true, nameRu: true, nameUz: true } },
        },
        take: 5,
      }),
      prisma.conversation.findMany({
        where: {
          OR: [
            { lastMessageText: { contains: q, mode: "insensitive" } },
            { patient: { fullName: { contains: q, mode: "insensitive" } } },
            ...apptPatientPhoneOr,
          ],
        },
        orderBy: { lastMessageAt: "desc" },
        select: {
          id: true,
          channel: true,
          status: true,
          lastMessageText: true,
          lastMessageAt: true,
          patient: { select: { id: true, fullName: true } },
        },
        take: 5,
      }),
    ]);

    return ok({ patients, doctors, appointments, conversations });
  }
);
