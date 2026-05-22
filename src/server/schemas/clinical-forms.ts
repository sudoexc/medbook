/**
 * Zod schemas for Phase G7 — e-prescriptions + sick leave certificates.
 *
 * Both forms share the same "issue, print, cancel" lifecycle so their
 * schemas live in one file. The print + verify endpoints take no body;
 * cancel is a tiny PATCH with `cancelReason`.
 */
import { z } from "zod";

const RxItemSchema = z.object({
  // The DrugCatalog id (cuid). Optional — doctors can hand-write items
  // for compounded preparations, herbal mixes, etc. that aren't in the
  // catalog yet. UI must require drugName when drugId is absent.
  drugId: z.string().trim().nullish(),
  // Snapshot of drug name at issue time. Survives catalog edits/removals.
  drugName: z.string().trim().min(1),
  dose: z.string().trim().min(1),
  route: z.string().trim().nullish(),
  frequency: z.string().trim().min(1),
  durationDays: z.coerce.number().int().min(1).max(365).nullish(),
  instructions: z.string().trim().nullish(),
});

export const CreateEPrescriptionSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).nullish(),
  visitNoteId: z.string().min(1).nullish(),
  diagnosisCode: z.string().trim().nullish(),
  diagnosisName: z.string().trim().nullish(),
  items: z.array(RxItemSchema).min(1, "at least one item required"),
  notes: z.string().trim().nullish(),
  // Days the prescription remains valid (defaults to 30 server-side).
  validForDays: z.coerce.number().int().min(1).max(365).default(30),
});

export const QueryEPrescriptionsSchema = z.object({
  patientId: z.string().min(1).optional(),
  visitNoteId: z.string().min(1).optional(),
  status: z.enum(["ISSUED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const CancelEPrescriptionSchema = z.object({
  cancelReason: z.string().trim().min(1, "reason required"),
});

export const CreateSickLeaveSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).nullish(),
  visitNoteId: z.string().min(1).nullish(),
  diagnosisCode: z.string().trim().nullish(),
  diagnosisName: z.string().trim().nullish(),
  regimen: z.enum(["OUTPATIENT", "HOSPITAL", "HOME"]).default("OUTPATIENT"),
  // ISO date strings (YYYY-MM-DD). Server stores as DATE.
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  restrictions: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
});

export const QuerySickLeavesSchema = z.object({
  patientId: z.string().min(1).optional(),
  visitNoteId: z.string().min(1).optional(),
  status: z.enum(["ISSUED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const CancelSickLeaveSchema = z.object({
  cancelReason: z.string().trim().min(1, "reason required"),
});

export type RxItem = z.infer<typeof RxItemSchema>;
