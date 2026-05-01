import { z } from "zod";

/**
 * Phase 9c — Branch CRUD schemas.
 *
 * `slug` is unique within a clinic (`@@unique([clinicId, slug])` in Prisma).
 * `timezone` defaults to the clinic's timezone server-side when not provided.
 * `isDefault` is enforced as singleton via a transaction in the route.
 */

export const CreateBranchSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "slug_format"),
  nameRu: z.string().min(1).max(200),
  nameUz: z.string().min(1).max(200),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const UpdateBranchSchema = CreateBranchSchema.partial();

export const QueryBranchSchema = z.object({
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const SetActiveBranchSchema = z.object({
  branchId: z.string().min(1).nullable(),
});

export type CreateBranch = z.infer<typeof CreateBranchSchema>;
export type UpdateBranch = z.infer<typeof UpdateBranchSchema>;
export type SetActiveBranch = z.infer<typeof SetActiveBranchSchema>;
