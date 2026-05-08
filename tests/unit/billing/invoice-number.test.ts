/**
 * Phase 19 Wave 3 — invoice number sequencer.
 *
 * Pure-function tests for `formatInvoiceNumber` + `parseInvoiceCounter`.
 * The DB-bound `nextInvoiceNumber` is exercised in
 * `tests/unit/billing/invoice.test.ts` where Prisma is mocked.
 */
import { describe, expect, it } from "vitest";
import {
  formatInvoiceNumber,
  parseInvoiceCounter,
} from "@/server/billing/invoice-number";

describe("formatInvoiceNumber", () => {
  it("zero-pads counter to four digits", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-0001");
    expect(formatInvoiceNumber(2026, 42)).toBe("INV-2026-0042");
    expect(formatInvoiceNumber(2026, 9999)).toBe("INV-2026-9999");
  });

  it("does not truncate counters above 9999", () => {
    // 5-digit counters are still well-formed; only the *minimum* width
    // is enforced. Real tenants stay below 9999/year.
    expect(formatInvoiceNumber(2026, 10000)).toBe("INV-2026-10000");
  });

  it("supports any 4-digit year", () => {
    expect(formatInvoiceNumber(2024, 5)).toBe("INV-2024-0005");
    expect(formatInvoiceNumber(2099, 5)).toBe("INV-2099-0005");
  });

  it("crosses the year boundary cleanly", () => {
    // The sequencer's responsibility is to pick the next number for a
    // given (clinic, year). Feed it the new year, counter resets to 1.
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-0001");
    expect(formatInvoiceNumber(2027, 1)).toBe("INV-2027-0001");
  });
});

describe("parseInvoiceCounter", () => {
  it("extracts the trailing counter from a well-formed number", () => {
    expect(parseInvoiceCounter("INV-2026-0001")).toBe(1);
    expect(parseInvoiceCounter("INV-2026-0042")).toBe(42);
    expect(parseInvoiceCounter("INV-2099-9999")).toBe(9999);
  });

  it("returns null for malformed strings", () => {
    expect(parseInvoiceCounter("BILL-2026-0001")).toBeNull();
    expect(parseInvoiceCounter("INV-26-0001")).toBeNull();
    expect(parseInvoiceCounter("INV-2026-")).toBeNull();
    expect(parseInvoiceCounter("INV-2026-abc")).toBeNull();
    expect(parseInvoiceCounter("")).toBeNull();
  });

  it("accepts 5+ digit counters", () => {
    expect(parseInvoiceCounter("INV-2026-12345")).toBe(12345);
  });
});
