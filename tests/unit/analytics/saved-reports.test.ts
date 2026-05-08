/**
 * Phase 18 Wave 3 — saved-reports paginator (pure helper).
 */
import { describe, it, expect } from "vitest";

import {
  paginate,
  SAVED_REPORT_PAGE_SIZE,
  SAVED_REPORT_PAGE_MAX,
} from "@/server/analytics/saved-reports";

describe("paginate", () => {
  it("returns sane defaults for an empty result set", () => {
    const r = paginate({ total: 0 });
    expect(r.page).toBe(1);
    expect(r.totalPages).toBe(0);
    expect(r.offset).toBe(0);
    expect(r.pageSize).toBe(SAVED_REPORT_PAGE_SIZE);
  });

  it("computes offset from page number", () => {
    const r = paginate({ total: 200, page: 3, pageSize: 50 });
    expect(r.offset).toBe(100);
    expect(r.totalPages).toBe(4);
  });

  it("clamps page above totalPages", () => {
    const r = paginate({ total: 10, page: 99, pageSize: 5 });
    expect(r.page).toBe(2);
    expect(r.offset).toBe(5);
  });

  it("clamps pageSize to SAVED_REPORT_PAGE_MAX", () => {
    const r = paginate({ total: 1, pageSize: SAVED_REPORT_PAGE_MAX + 100 });
    expect(r.pageSize).toBe(SAVED_REPORT_PAGE_MAX);
  });

  it("clamps page below 1 to 1", () => {
    const r = paginate({ total: 5, page: -3 });
    expect(r.page).toBe(1);
  });
});
