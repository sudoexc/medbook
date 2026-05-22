/**
 * Phase G8 — CDS override Zod schemas.
 *
 * One row per CDS warning the doctor chose to keep going with. The snapshot
 * fields are required so the audit row remains meaningful even if the live
 * CDS engine, drug catalog, or warning text shifts later.
 *
 * The warning kind/severity strings mirror the union types exposed by
 * `use-cds-drug-check` (CdsWarningKind / CdsSeverity) — they're kept as
 * plain strings on the wire and the row to avoid coupling the API to the
 * client-side enum.
 */
import { z } from "zod";

export const CdsOverrideReasonSchema = z.enum([
  "CLINICALLY_JUSTIFIED",
  "PATIENT_INFORMED",
  "ALTERNATIVES_TRIED",
  "FALSE_POSITIVE",
  "OTHER",
]);
export type CdsOverrideReason = z.infer<typeof CdsOverrideReasonSchema>;

export const CdsOverrideWarningKindSchema = z.enum([
  "ALLERGY",
  "INTERACTION",
  "DUPLICATE_CLASS",
  "PREGNANCY",
  "DIAGNOSIS_RISK",
]);

export const CdsOverrideSeveritySchema = z.enum([
  "CONTRAINDICATED",
  "MAJOR",
  "MODERATE",
  "MINOR",
]);

export const CreateCdsOverrideSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).nullish(),
  visitNoteId: z.string().min(1).nullish(),
  warningKind: CdsOverrideWarningKindSchema,
  severity: CdsOverrideSeveritySchema,
  warningTitle: z.string().trim().min(1),
  warningDetail: z.string().trim().min(1),
  // Stable key the client computes from the warning (used to dedupe
  // re-renders). Optional — when absent the row is still useful.
  warningKey: z.string().trim().nullish(),
  reason: CdsOverrideReasonSchema,
  reasonNote: z.string().trim().nullish(),
});

export const QueryCdsOverridesSchema = z.object({
  patientId: z.string().min(1).optional(),
  visitNoteId: z.string().min(1).optional(),
  doctorId: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateCdsOverrideInput = z.infer<typeof CreateCdsOverrideSchema>;
