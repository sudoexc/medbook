import { z } from "zod";

import {
  DOCTOR_SERVICE_DURATION_MAX,
  DOCTOR_SERVICE_DURATION_MIN,
} from "@/lib/doctor-service-terms";

/**
 * Schema for PUT /api/crm/doctors/[id]/services — replaces the full set
 * of services assigned to a doctor. `priceOverride` is in tiyin like
 * `Service.priceBase` (the editor types сумы and multiplies by 100; booking,
 * the kiosk and the price sheet all read it as tiyin, audit DR-02).
 * `durationMinOverride` is minutes per visit, in the catalog's own range.
 * `null`/omitted means "use Service.priceBase / Service.durationMin".
 */
export const DoctorServiceAssignmentSchema = z.object({
  serviceId: z.string().min(1).max(64),
  priceOverride: z.number().int().min(0).optional().nullable(),
  durationMinOverride: z
    .number()
    .int()
    .min(DOCTOR_SERVICE_DURATION_MIN)
    .max(DOCTOR_SERVICE_DURATION_MAX)
    .optional()
    .nullable(),
});

export const UpdateDoctorServicesSchema = z.object({
  assignments: z.array(DoctorServiceAssignmentSchema).max(500),
});

export type DoctorServiceAssignment = z.infer<
  typeof DoctorServiceAssignmentSchema
>;
export type UpdateDoctorServices = z.infer<typeof UpdateDoctorServicesSchema>;
