import { z } from "zod";

/**
 * Schema for PUT /api/crm/doctors/[id]/services — replaces the full set
 * of services assigned to a doctor. `priceOverride` is in UZS (integer,
 * tiin-free). `durationMinOverride` is minutes per visit. `null`/omitted
 * means "use Service.priceBase / Service.durationMin".
 */
export const DoctorServiceAssignmentSchema = z.object({
  serviceId: z.string().min(1).max(64),
  priceOverride: z.number().int().min(0).optional().nullable(),
  durationMinOverride: z.number().int().min(5).max(600).optional().nullable(),
});

export const UpdateDoctorServicesSchema = z.object({
  assignments: z.array(DoctorServiceAssignmentSchema).max(500),
});

export type DoctorServiceAssignment = z.infer<
  typeof DoctorServiceAssignmentSchema
>;
export type UpdateDoctorServices = z.infer<typeof UpdateDoctorServicesSchema>;
