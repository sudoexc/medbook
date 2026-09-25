import { z } from "zod";

import { UZS_PER_USD_MAX, UZS_PER_USD_MIN } from "@/lib/fx";

export const CreateExchangeRateSchema = z.object({
  date: z.coerce.date(),
  // сум per 1 USD, as the settings screen asks («12600»). The range keeps
  // the old «USD per сум» form (0.0000787) and typos out of the table:
  // every payment snapshot and USD LTV reads this number (audit AN-01).
  rateUsd: z.coerce.number().min(UZS_PER_USD_MIN).max(UZS_PER_USD_MAX),
  source: z.string().max(100).optional().nullable(),
});

export const QueryExchangeRateSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

export type CreateExchangeRate = z.infer<typeof CreateExchangeRateSchema>;
