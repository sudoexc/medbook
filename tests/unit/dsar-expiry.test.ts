/**
 * Phase 17 Wave 3 — date arithmetic for DSAR lifecycle.
 *
 * Pure functions; no DB. Verifies the published constants
 * (EXPORT_TTL_DAYS=30, DELETION_DELAY_DAYS=90) and the boolean helpers
 * used by the cron tick.
 */
import { describe, it, expect } from "vitest";

import {
  DELETION_DELAY_DAYS,
  EXPORT_TTL_DAYS,
  deletionScheduledFor,
  exportExpiresAt,
  isDeletionDue,
  isExportExpired,
} from "@/server/dsar/expiry";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("DSAR expiry math", () => {
  it("publishes the canonical TTL constants", () => {
    expect(EXPORT_TTL_DAYS).toBe(30);
    expect(DELETION_DELAY_DAYS).toBe(90);
  });

  it("exportExpiresAt = now + 30d", () => {
    const now = new Date("2026-05-01T10:00:00.000Z");
    const out = exportExpiresAt(now);
    expect(out.getTime() - now.getTime()).toBe(30 * MS_PER_DAY);
  });

  it("deletionScheduledFor = now + 90d", () => {
    const now = new Date("2026-05-01T10:00:00.000Z");
    const out = deletionScheduledFor(now);
    expect(out.getTime() - now.getTime()).toBe(90 * MS_PER_DAY);
  });

  it("isExportExpired flips at the boundary", () => {
    const now = new Date("2026-05-01T00:00:00.000Z");
    const before = new Date(now.getTime() - 1);
    const exact = new Date(now.getTime());
    const after = new Date(now.getTime() + 1);
    expect(isExportExpired(before, now)).toBe(true);
    // The helper treats "exactly now" as expired (<=).
    expect(isExportExpired(exact, now)).toBe(true);
    expect(isExportExpired(after, now)).toBe(false);
  });

  it("isDeletionDue flips at the boundary", () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    expect(isDeletionDue(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isDeletionDue(new Date(now.getTime()), now)).toBe(true);
    expect(isDeletionDue(new Date(now.getTime() + 1), now)).toBe(false);
  });
});
