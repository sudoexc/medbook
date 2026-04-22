/**
 * Shared Zod primitives for CRM API endpoints.
 * See docs/TZ.md §5, §6, §9.2.
 */
import { z } from "zod";

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

export const SortDirSchema = z.enum(["asc", "desc"]).default("desc");

export type Pagination = z.infer<typeof PaginationSchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
