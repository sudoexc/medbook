import { z } from "zod";

const CurrencyEnum = z.enum(["UZS", "USD"]);

export const CreateClinicSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  addressRu: z.string().max(500).optional().nullable(),
  addressUz: z.string().max(500).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  timezone: z.string().optional(),
  currency: CurrencyEnum.optional(),
  secondaryCurrency: CurrencyEnum.nullable().optional(),
  workdayStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  workdayEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  slotMin: z.number().int().min(5).max(240).optional(),
  active: z.boolean().optional(),
});

export const UpdateClinicSchema = CreateClinicSchema.partial();

export const QueryClinicSchema = z.object({
  active: z.coerce.boolean().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateClinic = z.infer<typeof CreateClinicSchema>;
export type UpdateClinic = z.infer<typeof UpdateClinicSchema>;
