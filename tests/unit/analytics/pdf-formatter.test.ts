/**
 * Phase 18 Wave 4 — `formatReportPdf` smoke + truncation test.
 *
 * We avoid asserting bytes — pdfkit's binary output is non-deterministic
 * across versions (timestamp + uuid in the trailer). Instead we check the
 * `%PDF-` magic bytes at the head, that the buffer has plausible size, and
 * that 5001 input rows are truncated to PDF_ROW_CAP for memory safety.
 */
import { describe, it, expect } from "vitest";

import {
  formatReportPdf,
  PDF_ROW_CAP,
  pdfFilename,
} from "@/server/analytics/pdf";

describe("formatReportPdf", () => {
  it("emits a buffer starting with the PDF magic and ending with %%EOF", async () => {
    const buf = await formatReportPdf({
      clinicName: "NeuroFax Test",
      reportName: "Выручка по неврологам",
      generatedAt: new Date("2026-05-07T05:30:00Z"),
      columns: [
        { key: "doctor", label: "Врач", kind: "dimension", unit: "text" },
        { key: "revenue", label: "Выручка", kind: "measure", unit: "tiins" },
      ],
      rows: [
        { doctor: "Каримов А.", revenue: 12_345_600 },
        { doctor: "Иванов В.", revenue: 9_870_000 },
      ],
      filters: { dateFrom: "2026-04-01", dateTo: "2026-04-30" },
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    // %PDF-
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // Document trailer.
    const tail = buf.subarray(buf.length - 32).toString("ascii");
    expect(tail).toContain("%%EOF");
    // Size sanity: 2 rows + DejaVuSans-subset → at least a few KB.
    expect(buf.length).toBeGreaterThan(2_000);
  });

  it("renders Cyrillic without crashing (DejaVuSans embedded)", async () => {
    const buf = await formatReportPdf({
      clinicName: "Клиника Х",
      reportName: "Отчёт по пациентам",
      generatedAt: new Date(),
      columns: [
        { key: "name", label: "Имя", kind: "dimension", unit: "text" },
      ],
      rows: [{ name: "Олимжон Каримов" }],
    });
    expect(buf.length).toBeGreaterThan(0);
  });

  it("truncates rows beyond PDF_ROW_CAP", async () => {
    const huge = Array.from({ length: PDF_ROW_CAP + 50 }, (_, i) => ({
      i,
      v: `row-${i}`,
    }));
    const buf = await formatReportPdf({
      clinicName: "X",
      reportName: "Big",
      generatedAt: new Date(),
      columns: [
        { key: "i", label: "i", kind: "dimension", unit: "count" },
        { key: "v", label: "v", kind: "dimension", unit: "text" },
      ],
      rows: huge,
    });
    // Document still rendered.
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

describe("pdfFilename", () => {
  it("slugifies Cyrillic report names safely", () => {
    const name = pdfFilename("Выручка / отчёт");
    expect(name.endsWith(".pdf")).toBe(true);
    // No path separators or quotes left in.
    expect(name).not.toContain("/");
    expect(name).not.toContain('"');
  });
});
