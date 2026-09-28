/**
 * /api/crm/patients/[id]/clinical-note — the doctor's note on the card
 * («Медицина → Клиническая заметка», audit PT-11).
 *
 * GET / PUT for clinical roles only (ADMIN, DOCTOR, NURSE: the same roles
 * that write allergies and diagnoses). The front desk and the call center
 * keep `Patient.notes`, the staff note on the card overview, which no
 * longer shares a column with this one.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";
import {
  CLINICAL_NOTE_ROLES,
  readClinicalNote,
  saveClinicalNote,
} from "@/server/patient/clinical-note";

const PutBody = z.object({
  text: z.string().max(20_000),
});

function patientIdFromUrl(request: Request): string {
  // .../patients/[id]/clinical-note → id at -2
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: [...CLINICAL_NOTE_ROLES] },
  async ({ request }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!patient) return notFound();
    return ok(await readClinicalNote(prisma, patientId));
  },
);

export const PUT = createApiHandler(
  { roles: [...CLINICAL_NOTE_ROLES], bodySchema: PutBody },
  async ({ request, body, ctx }) => {
    const patientId = patientIdFromUrl(request);
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, clinicId: true },
    });
    if (!patient) return notFound();
    const note = await saveClinicalNote(prisma, {
      clinicId: patient.clinicId,
      patientId,
      text: body.text,
      userId: ctx.kind === "TENANT" || ctx.kind === "SUPER_ADMIN" ? ctx.userId : null,
    });
    await audit(request, {
      action: "patient.clinical_note.update",
      entityType: "Patient",
      entityId: patientId,
      // That it changed, never what it says (audit SEC-09).
      meta: { cleared: note.text === "" },
    });
    return ok(note);
  },
);
