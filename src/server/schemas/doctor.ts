import { z } from "zod";

export const CreateDoctorSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  specializationRu: z.string().min(1).max(200),
  specializationUz: z.string().min(1).max(200),
  userId: z.string().optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  bioRu: z.string().max(5000).optional().nullable(),
  bioUz: z.string().max(5000).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  pricePerVisit: z.number().int().min(0).optional().nullable(),
  salaryPercent: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  /**
   * Phase 9c — optional branch assignment. When omitted the route falls
   * back to the active branch from the cookie (if any), then to the
   * clinic's default branch, so legacy callers stay backwards compatible.
   */
  branchId: z.string().min(1).optional().nullable(),
});

export const UpdateDoctorSchema = CreateDoctorSchema.partial();

export const QueryDoctorSchema = z.object({
  isActive: z.coerce.boolean().optional(),
  specialization: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// --- Schedule ----------------------------------------------------------------

export const ScheduleEntrySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  cabinetId: z.string().optional().nullable(),
  validFrom: z.coerce.date().optional().nullable(),
  validTo: z.coerce.date().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const ReplaceScheduleSchema = z.object({
  entries: z.array(ScheduleEntrySchema).max(100),
});

// --- Time Off ----------------------------------------------------------------

export const CreateTimeOffSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  reason: z.string().max(500).optional().nullable(),
});

export const QueryTimeOffSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateDoctor = z.infer<typeof CreateDoctorSchema>;
export type UpdateDoctor = z.infer<typeof UpdateDoctorSchema>;
export type ReplaceSchedule = z.infer<typeof ReplaceScheduleSchema>;
export type CreateTimeOff = z.infer<typeof CreateTimeOffSchema>;
