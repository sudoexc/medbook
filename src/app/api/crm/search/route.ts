/**
 * /api/crm/search — cross-entity global search (patients / doctors /
 * appointments / conversations). Returns up to 5 per category.
 * See docs/TZ.md §6.0 top-bar search.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { GLOBAL_SEARCH_MIN_CHARS } from "@/lib/global-search";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { patientSearchWhere } from "@/server/patient/search-where";
import { ok } from "@/server/http";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const u = new URL(request.url);
    const q = (u.searchParams.get("q") ?? "").trim();
    if (q.length < GLOBAL_SEARCH_MIN_CHARS) {
      return ok({
        patients: [],
        doctors: [],
        appointments: [],
        conversations: [],
      });
    }

    const phoneDigits = q.replace(/\D/g, "");
    const phoneNorm = normalizePhone(q);
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
        // The shared patient search, «Турматов 1969» included (audit PT-03).
        // DSAR-erased cards are not found (audit PT-07).
        where: { deletedAt: null, ...(patientSearchWhere(q) ?? {}) },
        select: {
          id: true,
          fullName: true,
          phone: true,
          photoUrl: true,
        },
        // Five of possibly dozens of «Каримов»: without an order Postgres
        // returned whichever five it met first, often not the one at the
        // desk (audit AC-23). The most recently seen first, never-seen cards
        // after them, the newest card first among those; the id keeps equal
        // rows stable between keystrokes.
        orderBy: [
          { lastVisitAt: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
          { id: "asc" },
        ],
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
