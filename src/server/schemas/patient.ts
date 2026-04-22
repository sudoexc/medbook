import { z } from "zod";

export const GenderEnum = z.enum(["MALE", "FEMALE"]);
export const LangEnum = z.enum(["RU", "UZ"]);
export const CommunicationChannelEnum = z.enum([
  "SMS",
  "TG",
  "CALL",
  "EMAIL",
  "VISIT",
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
export const PatientSegmentEnum = z.enum([
  "NEW",
  "ACTIVE",
  "DORMANT",
  "VIP",
  "CHURN",
]);

export const CreatePatientSchema = z.object({
  fullName: z.string().min(2).max(200),
  phone: z.string().min(3).max(40),
  birthDate: z.coerce.date().optional().nullable(),
  gender: GenderEnum.optional().nullable(),
  passport: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  telegramId: z.string().optional().nullable(),
  telegramUsername: z.string().max(64).optional().nullable(),
  preferredChannel: CommunicationChannelEnum.optional(),
  preferredLang: LangEnum.optional(),
  source: LeadSourceEnum.optional().nullable(),
  segment: PatientSegmentEnum.optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  notes: z.string().max(5000).optional().nullable(),
  discountPct: z.number().int().min(0).max(100).optional(),
  consentMarketing: z.boolean().optional(),
});

export const UpdatePatientSchema = CreatePatientSchema.partial();

export const QueryPatientSchema = z.object({
  q: z.string().optional(),
  segment: PatientSegmentEnum.optional(),
  source: LeadSourceEnum.optional(),
  gender: GenderEnum.optional(),
  tag: z.string().optional(),
  consent: z
    .enum(["yes", "no"])
    .optional(),
  balance: z
    .enum(["debt", "zero", "credit"])
    .optional(),
  registeredFrom: z.coerce.date().optional(),
  registeredTo: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z
    .enum(["createdAt", "lastVisitAt", "visitsCount", "ltv", "fullName"])
    .default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreatePatient = z.infer<typeof CreatePatientSchema>;
export type UpdatePatient = z.infer<typeof UpdatePatientSchema>;
export type QueryPatient = z.infer<typeof QueryPatientSchema>;
