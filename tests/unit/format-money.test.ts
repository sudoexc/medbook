/**
 * Phase 11 — Foundation polish: centralised currency formatting.
 *
 * Locks the `formatMoney` contract used by `<MoneyText />` and the various
 * CRM/site call sites. Spec: docs/TZ.md §9.4.
 */
import { describe, expect, it } from "vitest";

import { formatMoney, formatMoneyDual } from "@/lib/format";

describe("formatMoney — UZS", () => {
  it("renders zero with locale-correct unit (ru)", () => {
    expect(formatMoney(0, "UZS", "ru")).toBe("0 сум");
  });

  it("renders zero with locale-correct unit (uz)", () => {
    expect(formatMoney(0, "UZS", "uz")).toBe("0 so'm");
  });

  it("groups thousands and converts tiins → whole UZS (ru)", () => {
    // 200 000 UZS stored as 20 000 000 tiins.
    expect(formatMoney(20_000_000, "UZS", "ru")).toBe("200 000 сум");
  });

  it("groups thousands and converts tiins → whole UZS (uz)", () => {
    expect(formatMoney(20_000_000, "UZS", "uz")).toBe("200 000 so'm");
  });

  it("renders large bigint amounts without precision loss in the visible digits", () => {
    // 1 234 567 890 UZS = 123 456 789 000 tiins.
    expect(formatMoney(BigInt("123456789000"), "UZS", "ru")).toBe(
      "1 234 567 890 сум",
    );
  });

  it("renders negative amounts with leading minus", () => {
    // -150 000 UZS = -15 000 000 tiins.
    expect(formatMoney(-15_000_000, "UZS", "ru")).toBe("-150 000 сум");
  });

  it("returns empty string for null/undefined/non-finite input", () => {
    expect(formatMoney(null, "UZS", "ru")).toBe("");
    expect(formatMoney(undefined, "UZS", "ru")).toBe("");
    expect(formatMoney(Number.NaN, "UZS", "ru")).toBe("");
    expect(formatMoney(Number.POSITIVE_INFINITY, "UZS", "ru")).toBe("");
  });

  it("truncates fractional tiins (kopecks not displayed)", () => {
    // 99 tiins < 1 UZS → truncates to 0.
    expect(formatMoney(99, "UZS", "ru")).toBe("0 сум");
    // 150 tiins → 1 UZS (truncated).
    expect(formatMoney(150, "UZS", "ru")).toBe("1 сум");
  });
});

describe("formatMoney — USD", () => {
  it("renders cents → dollars with $ prefix and 2 decimals", () => {
    expect(formatMoney(12_550, "USD", "ru")).toBe("$125.50");
  });

  it("renders zero", () => {
    expect(formatMoney(0, "USD", "ru")).toBe("$0.00");
  });

  it("renders negative cents with leading minus", () => {
    expect(formatMoney(-12_550, "USD", "ru")).toBe("-$125.50");
  });
});

describe("formatMoneyDual", () => {
  it("returns both primary UZS and secondary USD when both provided", () => {
    const out = formatMoneyDual(150_000_000, 12_550, "ru");
    expect(out.primary).toBe("1 500 000 сум");
    expect(out.secondary).toBe("$125.50");
  });

  it("omits secondary when usdAmount is null", () => {
    const out = formatMoneyDual(150_000_000, null, "ru");
    expect(out.primary).toBe("1 500 000 сум");
    expect(out.secondary).toBeNull();
  });
});
