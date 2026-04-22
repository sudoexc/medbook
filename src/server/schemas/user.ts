import { z } from "zod";

export const RoleEnum = z.enum([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
]);

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: RoleEnum,
  password: z.string().min(8).max(200).optional(),
  phone: z.string().max(40).optional().nullable(),
  photoUrl: z.string().url().optional().nullable(),
  telegramId: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export const UpdateUserSchema = CreateUserSchema.partial();

export const QueryUserSchema = z.object({
  role: RoleEnum.optional(),
  active: z.coerce.boolean().optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
