/**
 * Ф3 (TZ-smart-constructor) — clinic/doctor-managed clinical protocols.
 *
 * Scope (global / clinic / personal) is NOT part of the payload — it is
 * derived from the caller's role in the route (DOCTOR → personal,
 * ADMIN → clinic-own). `prescriptionItems` reuses the visit-note draft
 * shape so «сохранить приём как протокол» round-trips losslessly.
 */
import { z } from "zod";

import { VisitPrescriptionItemSchema } from "./visit-note";

const ChipArray = z.array(z.string().min(1).max(500)).max(40);

export const CreateProtocolSchema = z.object({
  diagnosisCodePrefix: z.string().min(1).max(20),
  nameRu: z.string().min(1).max(300),
  nameUz: z.string().max(300).nullable().optional(),
  summaryRu: z.string().max(1_000).nullable().optional(),
  complaintsTemplate: ChipArray.default([]),
  anamnesisTemplate: ChipArray.default([]),
  examinationTemplate: ChipArray.default([]),
  // Legacy free-text lines — kept for older callers; new protocols carry
  // structured `prescriptionItems` instead.
  prescriptionsTemplate: ChipArray.default([]),
  prescriptionItems: z.array(VisitPrescriptionItemSchema).max(30).default([]),
  adviceTemplate: ChipArray.default([]),
  recommendedLabs: z.array(z.string().min(1).max(80)).max(30).default([]),
  conclusionTemplateMd: z.string().max(64_000).nullable().optional(),
  guideCode: z.string().max(120).nullable().optional(),
  followUpDays: z.number().int().min(1).max(365).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9_999).optional(),
});

export type CreateProtocolInput = z.infer<typeof CreateProtocolSchema>;

export const UpdateProtocolSchema = CreateProtocolSchema.partial().extend({
  active: z.boolean().optional(),
});

export type UpdateProtocolInput = z.infer<typeof UpdateProtocolSchema>;
