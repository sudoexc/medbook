/**
 * Phase 18 Wave 3 — pure helpers for the saved-reports surface.
 *
 * Pagination is page-based (offset = (page-1) * pageSize) so the list page
 * can deep-link to a page number; cursor pagination is overkill here — the
 * cap is 50 reports per page and we page-rank by createdAt DESC.
 */

export const SAVED_REPORT_PAGE_SIZE = 50;
export const SAVED_REPORT_PAGE_MAX = 100;

export interface PaginationInput {
  page?: number;
  pageSize?: number;
  total: number;
}

export interface PaginationOutput {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  /** Skip count to feed Prisma `skip:`. */
  offset: number;
}

export function paginate(input: PaginationInput): PaginationOutput {
  const pageSize = clampInt(
    input.pageSize ?? SAVED_REPORT_PAGE_SIZE,
    1,
    SAVED_REPORT_PAGE_MAX,
  );
  const total = Math.max(0, Math.trunc(input.total));
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const requestedPage = clampInt(input.page ?? 1, 1, Math.max(1, totalPages));
  const page = totalPages === 0 ? 1 : requestedPage;
  return {
    page,
    pageSize,
    totalPages,
    total,
    offset: (page - 1) * pageSize,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export interface SavedReportListRow {
  id: string;
  name: string;
  description: string | null;
  createdByUserId: string;
  createdByLabel: string | null;
  createdAt: Date | string;
  lastRunAt: Date | string | null;
  dimensionsCount: number;
  measuresCount: number;
}

export interface SavedReportListResponse {
  rows: SavedReportListRow[];
  pagination: PaginationOutput;
}
