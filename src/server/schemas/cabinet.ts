import { z } from "zod";

export const CreateCabinetSchema = z.object({
  number: z.string().min(1).max(20),
  floor: z.number().int().optional().nullable(),
  nameRu: z.string().max(200).optional().nullable(),
  nameUz: z.string().max(200).optional().nullable(),
  equipment: z.array(z.string().max(100)).max(50).optional(),
  isActive: z.boolean().optional(),
});

export const UpdateCabinetSchema = CreateCabinetSchema.partial();

export const QueryCabinetSchema = z.object({
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateCabinet = z.infer<typeof CreateCabinetSchema>;
export type UpdateCabinet = z.infer<typeof UpdateCabinetSchema>;
