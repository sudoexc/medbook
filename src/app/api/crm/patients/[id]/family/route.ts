/**
 * Phase 16 Wave 1 — CRM-side Family viewer.
 *
 * Read-only listing of who this patient is linked to: both directions
 * ("ownedBy" — this patient is the TG owner of these relatives, and
 * "ownerOf" — this patient was added as a relative by some TG owner).
 * The CRM UI shows them in a single "Семья" panel so receptionists can
 * jump to the related patient cards in one click.
 *
 * No write endpoints in CRM for Phase 16 — links are created from the
 * Mini App only (the TG owner is the consenting party). Receptionists
 * who need to delete a stale link can do so via the existing audit log
 * + the patient delete endpoint, or wait for Wave 3's CRM extension.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound } from "@/server/http";

function idFromUrl(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../patients/[id]/family
  // Last segment is "family"; the id is at -2.
  return segments[segments.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();

    const [owned, ownerOf] = await Promise.all([
      // Relatives THIS patient (as TG owner) has linked.
      prisma.patientFamily.findMany({
        where: {
          clinicId: patient.clinicId,
          ownerPatientId: id,
        },
        orderBy: { createdAt: "asc" },
        include: {
          linkedPatient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              birthDate: true,
              gender: true,
            },
          },
        },
      }),
      // TG owners who linked THIS patient as their relative.
      prisma.patientFamily.findMany({
        where: {
          clinicId: patient.clinicId,
          linkedPatientId: id,
        },
        orderBy: { createdAt: "asc" },
        include: {
          ownerPatient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              telegramUsername: true,
            },
          },
        },
      }),
    ]);

    return ok({
      ownedRelatives: owned.map((row) => ({
        linkId: row.id,
        relationship: row.relationship,
        createdAt: row.createdAt,
        patient: row.linkedPatient,
      })),
      linkedFromOwners: ownerOf.map((row) => ({
        linkId: row.id,
        relationship: row.relationship,
        createdAt: row.createdAt,
        owner: row.ownerPatient,
      })),
    });
  },
);
