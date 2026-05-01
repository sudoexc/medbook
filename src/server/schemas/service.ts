import { z } from "zod";

export const CreateServiceSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_-]+$/),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  category: z.string().max(100).optional().nullable(),
  durationMin: z.number().int().min(5).max(480).default(30),
  priceBase: z.number().int().min(0),
  isActive: z.boolean().optional(),
  /**
   * Doctors who will offer this service. Required, non-empty: every service
   * in the clinic must be performed by at least one doctor (no nurse-only
   * or self-serve services in this product). The route creates one
   * ServiceOnDoctor row per id, all with null overrides — admins can edit
   * per-doctor price/duration after creation from the doctor's own page.
   */
  doctorIds: z.array(z.string().min(1)).min(1),
});

export const UpdateServiceSchema = CreateServiceSchema.partial();

export const QueryServiceSchema = z.object({
  isActive: z.coerce.boolean().optional(),
  category: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateService = z.infer<typeof CreateServiceSchema>;
export type UpdateService = z.infer<typeof UpdateServiceSchema>;
