/**
 * /api/crm/cds/drug-check — POST drug interaction + allergy guard.
 *
 * Body: { patientId, prescriptions[], drugRows[]?, drugIds[]?, diagnosisCode?,
 *         diagnoses[]?, visitNoteId? }
 *
 * The reception UI calls this on every prescription change (debounced) to
 * surface warnings inline. Doctors must still acknowledge/override —
 * overrides are written to the audit log via a separate endpoint later
 * (G8 dashboard reads this signal).
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  MAX_ADDITIONAL_DIAGNOSES,
  parseAdditionalDiagnoses,
} from "@/lib/visit-diagnoses";
import { runDrugCheck } from "@/server/cds/drug-check";
import { ok, err } from "@/server/http";

const BodySchema = z.object({
  patientId: z.string().min(1),
  prescriptions: z.array(z.string().min(1)).max(50),
  // Ф2 — structured prescription rows, resolved by id without text match.
  // The label rides along so two rows of one drug under different names
  // («Ибупрофен», «Нурофен (ибупрофен)») are caught (audit G4-12), and the
  // form so a gel or eye drops are not checked as tablets (audit G4-22).
  drugRows: z
    .array(
      z.object({
        id: z.string().min(1),
        displayName: z.string().max(300).nullish(),
        form: z.string().max(40).nullish(),
      }),
    )
    .max(50)
    .optional(),
  // Bare ids, as a page still on the previous build sends them.
  drugIds: z.array(z.string().min(1)).max(50).optional(),
  diagnosisCode: z.string().trim().nullish(),
  // Every diagnosis of the visit on screen, main first (up to four since
  // 29.09.2026). A diagnosis in the clinic's own words has a name and no
  // code; the engine checks it by its words.
  diagnoses: z
    .array(
      z.object({
        code: z.string().trim().max(20).nullish(),
        name: z.string().trim().max(500).nullish(),
      }),
    )
    .max(1 + MAX_ADDITIONAL_DIAGNOSES)
    .optional(),
  // The visit on screen: once signed, its rows are mirrored into medication
  // courses, which must not be checked against the rows themselves as the
  // patient's current therapy (audit G4-03).
  visitNoteId: z.string().min(1).nullish(),
});

export const POST = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"], bodySchema: BodySchema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // A page that sends only the main code (the previous build, or a screen
    // that has not learned about the others) still gets the visit's other
    // diagnoses checked: they are read from the note it names. The main
    // one stays the code on screen, which may be ahead of the saved row.
    let diagnoses = body.diagnoses;
    if (diagnoses === undefined && body.visitNoteId) {
      const note = await prisma.visitNote.findFirst({
        where: {
          id: body.visitNoteId,
          clinicId: ctx.clinicId,
          patientId: body.patientId,
        },
        select: { additionalDiagnoses: true },
      });
      diagnoses = parseAdditionalDiagnoses(note?.additionalDiagnoses);
    }

    const result = await runDrugCheck({
      clinicId: ctx.clinicId,
      patientId: body.patientId,
      prescriptionLines: body.prescriptions,
      drugRows: body.drugRows ?? [],
      drugIds: body.drugIds ?? [],
      diagnosisCode: body.diagnosisCode ?? null,
      visitDiagnoses: diagnoses ?? [],
      visitNoteId: body.visitNoteId ?? null,
    });

    return ok(result);
  },
);
