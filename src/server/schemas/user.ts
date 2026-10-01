import { z } from "zod";

import { queryBool } from "./query-bool";

export const RoleEnum = z.enum([
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
]);

/**
 * A staff member's numeric Telegram user id: the chat the clinic bot writes
 * to for the template editor's test send (audit UX-10). Digits only, so a
 * pasted @username fails here instead of at Telegram.
 */
const StaffTelegramIdSchema = z
  .string()
  .trim()
  .regex(/^\d{1,20}$/, "invalid_telegram_id");

export const CreateUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    role: RoleEnum,
    password: z.string().min(8).max(200).optional(),
    phone: z.string().max(40).optional().nullable(),
    photoUrl: z.string().url().optional().nullable(),
    telegramId: StaffTelegramIdSchema.optional().nullable(),
    active: z.boolean().optional(),
    // Required when role=DOCTOR — binds the new user account to an existing
    // orphan Doctor record (Doctor.userId IS NULL). We don't create Doctor
    // rows inline because every Doctor must occupy a Cabinet.
    doctorId: z.string().optional(),
  })
  .refine((d) => d.role !== "DOCTOR" || Boolean(d.doctorId), {
    message: "doctorId is required when role=DOCTOR",
    path: ["doctorId"],
  });

export const UpdateUserSchema = z
  .object({
    email: z.string().email().optional(),
    name: z.string().min(1).max(200).optional(),
    role: RoleEnum.optional(),
    password: z.string().min(8).max(200).optional(),
    phone: z.string().max(40).optional().nullable(),
    photoUrl: z.string().url().optional().nullable(),
    telegramId: StaffTelegramIdSchema.optional().nullable(),
    active: z.boolean().optional(),
    doctorId: z.string().optional(),
  });

export const QueryUserSchema = z.object({
  role: RoleEnum.optional(),
  active: queryBool(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
