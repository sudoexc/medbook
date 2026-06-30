/**
 * Phase 16 Wave 3 — Prescription Zod schemas (CRM side).
 *
 * Mirrored from `model Prescription` in prisma/schema.prisma. The
 * `schedule` JSON shape is `{ times: HH:mm[], days?: number, startsAt?:
 * ISO }` — see `parseSchedule` in
 * `src/lib/patient-experience/medication-schedule.ts` for the runtime
 * tolerator.
 */
import { z } from "zod";

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "invalid_time");

export const PrescriptionScheduleSchema = z.object({
  times: z.array(HHmm).min(1, "times_required").max(8, "times_too_many"),
  // `days` is total active duration. Null = open-ended (chronic). Capped at
  // 365 — a longer course should be re-issued anyway.
  days: z.number().int().min(1).max(365).optional().nullable(),
  // ISO start. If omitted, the API handler stamps `now()`.
  startsAt: z.string().datetime().optional().nullable(),
});

export const PrescriptionStatusEnum = z.enum([
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
]);

export const CreatePrescriptionSchema = z.object({
  // D-7 — authorship is decided server-side. A DOCTOR always prescribes as
  // themselves (resolved from the session, body value ignored); only an ADMIN
  // prescribing on behalf of a doctor needs to supply this, and that act is
  // audited. Optional here so doctors don't have to send it.
  doctorId: z.string().min(1).optional(),
  drugName: z.string().min(1).max(120),
  dosage: z.string().min(1).max(200),
  schedule: PrescriptionScheduleSchema,
  notes: z.string().max(2000).optional().nullable(),
  remindersEnabled: z.boolean().optional().default(false),
  status: PrescriptionStatusEnum.optional().default("ACTIVE"),
});

export const UpdatePrescriptionSchema = z.object({
  drugName: z.string().min(1).max(120).optional(),
  dosage: z.string().min(1).max(200).optional(),
  schedule: PrescriptionScheduleSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
  remindersEnabled: z.boolean().optional(),
  status: PrescriptionStatusEnum.optional(),
});

export type CreatePrescription = z.infer<typeof CreatePrescriptionSchema>;
export type UpdatePrescription = z.infer<typeof UpdatePrescriptionSchema>;
