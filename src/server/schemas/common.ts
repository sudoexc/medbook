/**
 * Shared Zod primitives for CRM API endpoints.
 * See docs/TZ.md §5, §6, §9.2.
 */
import { z } from "zod";

import { isTashkentDateString } from "@/lib/tashkent-time";

export const CuidSchema = z.string().min(10).max(40);

export const IdParamSchema = z.object({
  id: CuidSchema,
});

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const PageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const DateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * A Tashkent calendar day as an `<input type="date">` sends it (YYYY-MM-DD).
 * Pair with `tashkentDayRange` for an inclusive from/to filter; `z.coerce.date`
 * turned the same string into UTC midnight, five hours off (audit ST-09).
 */
export const TashkentDaySchema = z
  .string()
  .refine(isTashkentDateString, { message: "expected YYYY-MM-DD" });

export const SortDirSchema = z.enum(["asc", "desc"]).default("desc");

export type Pagination = z.infer<typeof PaginationSchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
