import { describe, expect, it } from "vitest";

import { sumToTiyin, tiyinToSum } from "@/lib/money-input";
import { formatMoney } from "@/lib/format";

describe("money inputs: сумы on screen, tiyin in the database", () => {
  it("shows a stored 15 000 000 tiyin as 150 000 сум", () => {
    expect(tiyinToSum(15_000_000)).toBe(150_000);
  });

  it("saves a typed 200 000 сум as 20 000 000 tiyin", () => {
    expect(sumToTiyin(200_000)).toBe(20_000_000);
  });

  it("round-trips without drift", () => {
    for (const sum of [0, 50_000, 150_000, 300_000, 1_234_567]) {
      expect(tiyinToSum(sumToTiyin(sum))).toBe(sum);
    }
  });

  it("agrees with formatMoney, which the rest of the CRM uses", () => {
    expect(formatMoney(sumToTiyin(200_000), "UZS", "ru").replace(/\D/g, "")).toContain("200000");
  });

  it("treats empty and junk input as zero, never negative", () => {
    expect(sumToTiyin(Number(""))).toBe(0);
    expect(sumToTiyin(Number.NaN)).toBe(0);
    expect(sumToTiyin(-5)).toBe(0);
    expect(tiyinToSum(null)).toBe(0);
  });
});
