/**
 * /api/crm/doctors/me/patients/[patientId]/documents — documents the doctor
 * is allowed to see for this patient.
 *
 * Anti-leak: same rule as the sibling `/visits` route — caller must have at
 * least one appointment with this patient. Without that, every patient row
 * in the clinic would be reachable just by guessing IDs.
 *
 * Scope of "visible to me": any `Document` whose patientId matches AND
 * EITHER its `appointmentId` points to one of my appointments, OR the
 * `appointmentId` is null (unbound clinic-wide doc, e.g. referral letter
 * scanned into the patient's file). We don't try to show another doctor's
 * appointment-bound docs — that's their case.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, notFound, parseQuery } from "@/server/http";

const QuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type DocumentRow = {
  id: string;
  title: string;
  type: string;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
  appointmentId: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
};

function patientIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("documents");
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

    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const patient = await prisma.patient.findFirst({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) return notFound();

    const hasRelationship = await prisma.appointment.findFirst({
      where: { patientId, doctorId: doctor.id },
      select: { id: true },
    });
    if (!hasRelationship) return notFound();

    const take = q.limit + 1;
    const rows = await prisma.document.findMany({
      where: {
        patientId,
        OR: [
          { appointment: { doctorId: doctor.id } },
          { appointmentId: null },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        fileUrl: true,
        mimeType: true,
        sizeBytes: true,
        appointmentId: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });

    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }

    const out: DocumentRow[] = rows.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      fileUrl: d.fileUrl,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      appointmentId: d.appointmentId,
      uploadedBy: d.uploadedBy,
      createdAt: d.createdAt.toISOString(),
    }));

    return ok({ rows: out, nextCursor });
  },
);
