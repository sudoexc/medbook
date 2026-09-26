/**
 * /api/crm/cds/drug-check — POST drug interaction + allergy guard.
 *
 * Body: { patientId, prescriptions[], drugRows[]?, drugIds[]?, diagnosisCode? }
 *
 * The reception UI calls this on every prescription change (debounced) to
 * surface warnings inline. Doctors must still acknowledge/override —
 * overrides are written to the audit log via a separate endpoint later
 * (G8 dashboard reads this signal).
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { runDrugCheck } from "@/server/cds/drug-check";
import { ok, err } from "@/server/http";

const BodySchema = z.object({
  patientId: z.string().min(1),
  prescriptions: z.array(z.string().min(1)).max(50),
  // Ф2 — structured prescription rows, resolved by id without text match.
  // The label rides along so two rows of one drug under different names
  // («Ибупрофен», «Нурофен (ибупрофен)») are caught (audit G4-12).
  drugRows: z
    .array(
      z.object({
        id: z.string().min(1),
        displayName: z.string().max(300).nullish(),
      }),
    )
    .max(50)
    .optional(),
  // Bare ids, as a page still on the previous build sends them.
  drugIds: z.array(z.string().min(1)).max(50).optional(),
  diagnosisCode: z.string().trim().nullish(),
});

export const POST = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"], bodySchema: BodySchema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const result = await runDrugCheck({
      clinicId: ctx.clinicId,
      patientId: body.patientId,
      prescriptionLines: body.prescriptions,
      drugRows: body.drugRows ?? [],
      drugIds: body.drugIds ?? [],
      diagnosisCode: body.diagnosisCode ?? null,
    });

    return ok(result);
  },
);
