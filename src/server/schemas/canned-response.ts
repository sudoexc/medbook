import { z } from "zod";

export const CannedLangEnum = z.enum(["RU", "UZ"]);

export const CreateCannedResponseSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  lang: CannedLangEnum.default("RU"),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const UpdateCannedResponseSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    lang: CannedLangEnum.optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "EmptyUpdate" });

export const QueryCannedResponseSchema = z.object({
  lang: CannedLangEnum.optional(),
  q: z.string().optional(),
});

export type CreateCannedResponse = z.infer<typeof CreateCannedResponseSchema>;
export type UpdateCannedResponse = z.infer<typeof UpdateCannedResponseSchema>;
