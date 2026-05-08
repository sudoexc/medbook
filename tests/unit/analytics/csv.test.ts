/**
 * Phase 18 Wave 3 — `formatCsv` edge-case coverage.
 *
 * These cover the cells that real users WILL trip over: commas inside
 * doctor names, Cyrillic, currency-as-tiins, and the BOM that keeps Excel
 * happy with UTF-8.
 */
import { describe, it, expect } from "vitest";

import { formatCsv, csvFilename } from "@/server/analytics/csv";

const BOM = "﻿";

describe("formatCsv", () => {
  it("starts the document with a UTF-8 BOM", () => {
    const csv = formatCsv([{ key: "a", label: "A" }], []);
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it("renders the header row from column labels", () => {
    const csv = formatCsv(
      [
        { key: "a", label: "Visits" },
        { key: "b", label: "Revenue" },
      ],
      [],
    );
    const firstLine = csv.slice(BOM.length).split("\r\n")[0];
    expect(firstLine).toBe("Visits,Revenue");
  });

  it("quotes cells that contain commas, quotes, or newlines", () => {
    const csv = formatCsv(
      [
        { key: "name", label: "Name" },
        { key: "note", label: "Note" },
      ],
      [
        { name: "Smith, John", note: 'has "quotes" inside' },
        { name: "multi\nline", note: "ok" },
      ],
    );
    const body = csv.slice(BOM.length);
    expect(body).toContain('"Smith, John"');
    expect(body).toContain('"has ""quotes"" inside"');
    expect(body).toContain('"multi\nline"');
  });

  it("preserves Cyrillic content", () => {
    const csv = formatCsv(
      [{ key: "name", label: "Имя" }],
      [{ name: "Доктор Иванов" }],
    );
    expect(csv).toContain("Имя");
    expect(csv).toContain("Доктор Иванов");
  });

  it("renders tiins cells as plain numerics (no spaces, no currency suffix)", () => {
    const csv = formatCsv(
      [{ key: "rev", label: "Revenue", unit: "tiins" }],
      [
        { rev: 12345678 },
        { rev: BigInt(100) },
        { rev: 9999 },
      ],
    );
    const body = csv.slice(BOM.length).split("\r\n");
    expect(body[1]).toBe("123456.78");
    expect(body[2]).toBe("1.00");
    expect(body[3]).toBe("99.99");
  });

  it("renders bigint counts as plain integers", () => {
    const csv = formatCsv(
      [{ key: "n", label: "Count", unit: "count" }],
      [{ n: BigInt(42) }],
    );
    const lines = csv.slice(BOM.length).split("\r\n");
    expect(lines[1]).toBe("42");
  });

  it("emits empty string for null/undefined cells", () => {
    const csv = formatCsv(
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      [{ a: null, b: undefined }],
    );
    const body = csv.slice(BOM.length).split("\r\n");
    expect(body[1]).toBe(",");
  });

  it("ends every line with CRLF (RFC 4180)", () => {
    const csv = formatCsv(
      [{ key: "a", label: "A" }],
      [{ a: "x" }, { a: "y" }],
    );
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(4); // header + 2 rows + trailing empty
  });
});

describe("csvFilename", () => {
  it("uses the trimmed name and ISO date", () => {
    const out = csvFilename("Revenue Report", new Date("2026-05-07T10:00:00Z"));
    expect(out).toBe("Revenue-Report-2026-05-07.csv");
  });

  it("falls back to `report` when the name is empty", () => {
    expect(csvFilename("", new Date("2026-01-02"))).toBe("report-2026-01-02.csv");
  });

  it("strips characters that confuse Content-Disposition", () => {
    const out = csvFilename('weird"name?', new Date("2026-05-07"));
    expect(out).not.toContain('"');
    expect(out).not.toContain("?");
  });
});
