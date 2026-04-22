import { z } from "zod";

export const CreateExchangeRateSchema = z.object({
  date: z.coerce.date(),
  rateUsd: z.coerce.number().positive(),
  source: z.string().max(100).optional().nullable(),
});

export const QueryExchangeRateSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

export type CreateExchangeRate = z.infer<typeof CreateExchangeRateSchema>;
