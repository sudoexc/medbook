/**
 * Phase 18 Wave 4 — PDF formatter for the report-builder export.
 *
 * Pure function: takes the already-run report rows + columns and emits a
 * single-shot Buffer. The route handler / worker calls `runReport(...)`
 * first, then hands the result here. We never touch Prisma in this module.
 *
 * Why pdfkit (over Puppeteer/Playwright/@react-pdf): pdfkit ships pure JS,
 * no Chromium download, ~2MB on disk. The dashboard tables we render are
 * simple — no SVG, no grid layout — so pdfkit's primitive `text/rect`
 * calls are sufficient and 5-10× faster than HTML→PDF.
 *
 * Why DejaVuSans: pdfkit's bundled Helvetica is Latin-only — Cyrillic
 * collapses to dotted glyphs. DejaVuSans (305KB TTF in `src/server/fonts/`)
 * covers Cyrillic + Latin Uzbek apostrophe characters in a single face.
 *
 * Why a 5000-row hard cap (independent of the report's `limit`): pdfkit
 * accumulates the whole document in memory before the buffer is finalised,
 * and the dashboard tables are 5-15 columns wide — at 5000 rows we land
 * around 2-4MB of binary, which still fits the 25MB email-attachment ceiling
 * imposed by most SMTP providers. Above 5000 rows the user wants CSV anyway
 * (Excel, deeper pivots) so we surface a "use CSV for full export" hint
 * inline in the PDF.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

export interface PdfReportColumn {
  key: string;
  label: string;
  kind?: "dimension" | "measure";
  unit?: "count" | "tiins" | "ratio" | "text";
}

export interface PdfFilterSummary {
  dateFrom?: string | null;
  dateTo?: string | null;
  branches?: string[] | null;
  doctors?: string[] | null;
  statuses?: string[] | null;
}

export interface FormatReportPdfInput {
  clinicName: string;
  reportName: string;
  description?: string | null;
  generatedAt: Date;
  columns: ReadonlyArray<PdfReportColumn>;
  rows: ReadonlyArray<Record<string, unknown>>;
  filters?: PdfFilterSummary;
  /** Defaults to "ru". Picks date / number format. */
  locale?: "ru" | "uz";
}

export const PDF_ROW_CAP = 5000;

let fontBytesPromise: Promise<Buffer> | null = null;
async function loadDejaVuSans(): Promise<Buffer> {
  if (!fontBytesPromise) {
    const fontPath = path.join(process.cwd(), "src", "server", "fonts", "DejaVuSans.ttf");
    fontBytesPromise = fs.readFile(fontPath);
  }
  return fontBytesPromise;
}

const RU_MONTHS_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function formatGeneratedAtRu(d: Date): string {
  // "07 мая 2026, 14:32 UZS" — the brief specifies this exact shape.
  // We render the wall-clock in Asia/Tashkent so a worker run from a
  // server in any zone shows the user's local time.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = parseInt(get("month"), 10);
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  return `${day} ${RU_MONTHS_GENITIVE[month - 1]} ${year}, ${hour}:${minute} UZS`;
}

function formatTiinsAsUzs(value: bigint | number): string {
  const minor = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(minor)) return "0 UZS";
  const whole = Math.trunc(minor / 100);
  const sign = whole < 0 ? "-" : "";
  const abs = Math.abs(whole).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} UZS`;
}

function formatCellText(value: unknown, unit: PdfReportColumn["unit"]): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "bigint") {
    if (unit === "tiins") return formatTiinsAsUzs(value);
    return value.toString();
  }
  if (typeof value === "number") {
    if (unit === "tiins") return formatTiinsAsUzs(value);
    if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
    if (Number.isInteger(value)) return value.toLocaleString("ru-RU");
    return value.toString();
  }
  if (typeof value === "string") {
    if (unit === "tiins") {
      const n = Number(value);
      if (Number.isFinite(n)) return formatTiinsAsUzs(n);
    }
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

function buildFilterLines(filters: PdfFilterSummary | undefined): string[] {
  if (!filters) return [];
  const lines: string[] = [];
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? filters.dateFrom.slice(0, 10) : "—";
    const to = filters.dateTo ? filters.dateTo.slice(0, 10) : "—";
    lines.push(`Период: ${from} — ${to}`);
  }
  if (filters.branches && filters.branches.length > 0) {
    lines.push(`Филиалы: ${filters.branches.join(", ")}`);
  }
  if (filters.doctors && filters.doctors.length > 0) {
    lines.push(`Врачи: ${filters.doctors.join(", ")}`);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    lines.push(`Статусы: ${filters.statuses.join(", ")}`);
  }
  return lines;
}

/**
 * Render the report to PDF. Returns a fully buffered Buffer.
 *
 * Layout: A4 portrait when columns ≤ 6, landscape otherwise. Margin = 36pt.
 * Header → filter block → table (sticky header per page) → footer with
 * page numbers + neurofax.uz mark. Truncation banner at the bottom of the
 * last page when input exceeded `PDF_ROW_CAP`.
 */
export async function formatReportPdf(input: FormatReportPdfInput): Promise<Buffer> {
  const totalRows = input.rows.length;
  const truncated = totalRows > PDF_ROW_CAP;
  const rows = truncated ? input.rows.slice(0, PDF_ROW_CAP) : input.rows;

  const landscape = input.columns.length > 6;
  const fontBytes = await loadDejaVuSans();

  const doc = new PDFDocument({
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    margins: { top: 48, left: 36, right: 36, bottom: 48 },
    info: {
      Title: input.reportName,
      Author: input.clinicName,
      Creator: "NeuroFax CRM",
    },
  });

  // Embed DejaVuSans for Cyrillic + Latin-Uzbek glyph coverage.
  doc.registerFont("body", fontBytes);
  doc.font("body");

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finalised = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const top = doc.page.margins.top;
  const bottom = doc.page.margins.bottom;
  const usableWidth = pageWidth - left - right;

  // Header block (clinic + report name + timestamp).
  doc.fontSize(9).fillColor("#666").text(input.clinicName, left, top);
  doc.moveDown(0.2);
  doc
    .fontSize(16)
    .fillColor("#111")
    .text(input.reportName, left, doc.y, { width: usableWidth });
  doc.moveDown(0.15);
  doc
    .fontSize(9)
    .fillColor("#666")
    .text(`Сгенерировано: ${formatGeneratedAtRu(input.generatedAt)}`, {
      width: usableWidth,
    });

  if (input.description) {
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#444").text(input.description, { width: usableWidth });
  }

  // Filter summary.
  const filterLines = buildFilterLines(input.filters);
  if (filterLines.length > 0) {
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#111").text("Фильтры", { width: usableWidth });
    doc.moveDown(0.15);
    for (const ln of filterLines) {
      doc.fontSize(9).fillColor("#444").text(ln, { width: usableWidth });
    }
  }
  doc.moveDown(0.6);

  // Table layout: equal-width columns with measure columns slightly wider
  // (currency formatting leaves more whitespace if cells are too narrow).
  const colCount = Math.max(1, input.columns.length);
  const colWidth = usableWidth / colCount;
  const rowHeight = 18;
  const headerHeight = 22;

  const drawTableHeader = (yStart: number): number => {
    doc
      .rect(left, yStart, usableWidth, headerHeight)
      .fillColor("#f3f4f6")
      .fill();
    let x = left;
    doc.fontSize(9).fillColor("#111");
    for (const c of input.columns) {
      doc.text(c.label, x + 6, yStart + 6, {
        width: colWidth - 12,
        ellipsis: true,
        lineBreak: false,
      });
      x += colWidth;
    }
    return yStart + headerHeight;
  };

  let cursorY = doc.y;
  const tableBottomLimit = pageHeight - bottom - 24; // leave space for footer
  cursorY = drawTableHeader(cursorY);

  for (let i = 0; i < rows.length; i++) {
    if (cursorY + rowHeight > tableBottomLimit) {
      doc.addPage();
      cursorY = doc.page.margins.top;
      cursorY = drawTableHeader(cursorY);
    }
    if (i % 2 === 1) {
      doc
        .rect(left, cursorY, usableWidth, rowHeight)
        .fillColor("#fafafa")
        .fill();
    }
    let x = left;
    const row = rows[i] ?? {};
    for (const c of input.columns) {
      const text = formatCellText(row[c.key], c.unit);
      const isMeasure = c.kind === "measure" || c.unit === "tiins" || c.unit === "count" || c.unit === "ratio";
      doc
        .fontSize(9)
        .fillColor("#111")
        .text(text, x + 6, cursorY + 4, {
          width: colWidth - 12,
          align: isMeasure ? "right" : "left",
          ellipsis: true,
          lineBreak: false,
        });
      x += colWidth;
    }
    cursorY += rowHeight;
  }

  // Truncation warning (only on overflow).
  if (truncated) {
    if (cursorY + 24 > tableBottomLimit) {
      doc.addPage();
      cursorY = doc.page.margins.top;
    } else {
      cursorY += 8;
    }
    doc
      .fontSize(9)
      .fillColor("#b45309")
      .text(
        `Показано первые ${PDF_ROW_CAP.toLocaleString("ru-RU")} строк из ${totalRows.toLocaleString("ru-RU")} — для полной выгрузки используйте CSV.`,
        left,
        cursorY,
        { width: usableWidth },
      );
  }

  // Page numbers + footer mark across all pages.
  // Why post-pass: pdfkit only knows total page count after the doc is
  // built, so we re-iterate via `bufferedPageRange` to stamp footers.
  const range = doc.bufferedPageRange();
  for (let pageIdx = range.start; pageIdx < range.start + range.count; pageIdx++) {
    doc.switchToPage(pageIdx);
    const footerY = pageHeight - bottom + 12;
    doc.fontSize(8).fillColor("#888");
    doc.text(
      `Страница ${pageIdx - range.start + 1} из ${range.count}`,
      left,
      footerY,
      { width: usableWidth / 2, align: "left", lineBreak: false },
    );
    doc.text("neurofax.uz", left + usableWidth / 2, footerY, {
      width: usableWidth / 2,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  return finalised;
}

/**
 * Build a `<name>-YYYY-MM-DD.pdf` filename mirroring the CSV helper.
 */
export function pdfFilename(name: string, now: Date = new Date()): string {
  const safe =
    name
      .trim()
      .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "report";
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${safe}-${yyyy}-${mm}-${dd}.pdf`;
}
