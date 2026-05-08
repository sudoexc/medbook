/**
 * Phase 18 Wave 1 — cohort-resolver shape test.
 *
 * Stubs `$queryRawUnsafe` and asserts the resolver normalizes raw rows
 * into the {cohorts, cells} matrix the W2 dashboard expects.
 */
import { describe, it, expect, vi } from "vitest";

import { resolveCohortRetention } from "@/server/analytics/cohort-resolver";

describe("resolveCohortRetention", () => {
  it("dedupes cohorts and converts cells to plain numbers", async () => {
    const stub = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          clinicId: "c",
          cohortMonth: new Date(Date.UTC(2026, 0, 1)),
          monthOffset: BigInt(0),
          activePatientCount: BigInt(100),
        },
        {
          clinicId: "c",
          cohortMonth: new Date(Date.UTC(2026, 0, 1)),
          monthOffset: BigInt(1),
          activePatientCount: BigInt(60),
        },
        {
          clinicId: "c",
          cohortMonth: new Date(Date.UTC(2026, 1, 1)),
          monthOffset: BigInt(0),
          activePatientCount: BigInt(80),
        },
      ]),
    };

    const result = await resolveCohortRetention(stub, "c");

    expect(stub.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("mv:mv_cohort_retention");
    expect(result.cohorts).toEqual(["2026-01", "2026-02"]);
    expect(result.cells).toHaveLength(3);
    expect(result.cells[0]).toEqual({
      cohortMonth: "2026-01",
      monthOffset: 0,
      activePatientCount: 100,
    });
    expect(result.cells[2]).toEqual({
      cohortMonth: "2026-02",
      monthOffset: 0,
      activePatientCount: 80,
    });
  });

  it("returns an empty matrix when no rows are present", async () => {
    const stub = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    const result = await resolveCohortRetention(stub, "empty-clinic");
    expect(result.cohorts).toEqual([]);
    expect(result.cells).toEqual([]);
  });

  it("passes clinicId as the first bound parameter", async () => {
    const stub = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    await resolveCohortRetention(stub, "tenant-x");
    const [, ...params] = stub.$queryRawUnsafe.mock.calls[0]!;
    expect(params[0]).toBe("tenant-x");
  });
});
