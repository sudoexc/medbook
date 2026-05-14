import { z } from "zod";

/**
 * Phase 3b — Reception AI request schemas.
 *
 * Every endpoint takes a `noteId` (server hydrates the draft) so the client
 * never has to ship the structured fields back. `locale` controls the
 * output language; defaults to "ru" because the curated ICD-10 universe
 * is RU-only today.
 */

export const ReceptionAiInputSchema = z.object({
  noteId: z.string().min(1),
  locale: z.enum(["ru", "uz"]).optional().default("ru"),
});

export type ReceptionAiInput = z.infer<typeof ReceptionAiInputSchema>;
