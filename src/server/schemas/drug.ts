import { z } from "zod";

export const QueryDrugSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  /** ATC prefix filter, e.g. "C09" matches ACE inhibitors + ARBs. */
  atc: z.string().optional(),
  /** Filter by ICD-10 prefix — used by the diagnosis-driven suggestion engine. */
  indication: z.string().optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
