import { z } from "zod";

export const LeadStatusEnum = z.enum([
  "NEW",
  "CONTACTED",
  "CONVERTED",
  "CANCELLED",
]);
export const LeadSourceEnum = z.enum([
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
]);
export const ChannelTypeEnum = z.enum([
  "WALKIN",
  "PHONE",
  "TELEGRAM",
  "WEBSITE",
  "KIOSK",
]);

export const UpdateOnlineRequestSchema = z.object({
  status: LeadStatusEnum.optional(),
  patientId: z.string().nullable().optional(),
  doctorId: z.string().nullable().optional(),
  comment: z.string().max(5000).nullable().optional(),
  preferredAt: z.coerce.date().nullable().optional(),
});

export const QueryOnlineRequestSchema = z.object({
  status: LeadStatusEnum.optional(),
  source: LeadSourceEnum.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type UpdateOnlineRequest = z.infer<typeof UpdateOnlineRequestSchema>;
