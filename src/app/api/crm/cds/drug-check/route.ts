/**
 * /api/crm/cds/drug-check — POST drug interaction + allergy guard.
 *
 * Body: { patientId, prescriptions[], diagnosisCode? }
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
  // Ф2 — ids from structured prescription rows (resolved without text match).
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
      drugIds: body.drugIds ?? [],
      diagnosisCode: body.diagnosisCode ?? null,
    });

    return ok(result);
  },
);
