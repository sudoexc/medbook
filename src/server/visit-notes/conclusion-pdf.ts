/**
 * P1.1 — Patient CONCLUSION handout → PDF.
 *
 * Renders `VisitNote.patientHandoutMarkdown` (and ONLY that — never the
 * clinical `bodyMarkdown`) into a single-page A4 PDF the patient receives in
 * the Mini App. Shares the block parser with the print route via
 * `render-handout.ts` so the doctor sees the same structure they authored.
 *
 * Why pdfkit + DejaVuSans: same rationale as `analytics/pdf.ts` — pure JS, no
 * Chromium, and DejaVuSans is the one bundled face that covers Cyrillic + the
 * Latin-Uzbek apostrophe glyphs. We register it before any text is drawn so
 * pdfkit never falls back to (Latin-only) Helvetica. The font loader is
 * duplicated here rather than shared to keep this module independent of the
 * analytics export path.
 *
 * Inline emphasis is intentionally flattened to plain text: the repo ships
 * only the regular weight, so a faux-bold would look worse than clean prose
 * on a patient handout.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";
import QRCode from "qrcode";

import type { PrescriptionLikeRow } from "@/lib/catalogs/prescription-format";
import {
  buildMedicationGrid,
  parseHandoutBlocks,
  stripInlineMarkers,
} from "@/server/visit-notes/render-handout";

export interface ConclusionPdfInput {
  clinicName: string;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  doctorName?: string | null;
  patientName: string;
  /** Pre-formatted visit date (+ optional time), localised by the caller. */
  visitDateLabel: string;
  /** Ф0 — human-readable document number ("NF-2026-000123"), if allocated. */
  documentNumber?: string | null;
  handoutMarkdown: string;
  /** Ф5 — structured rows for the medication intake grid (may be empty). */
  prescriptions?: PrescriptionLikeRow[] | null;
  /** Ф5 — public /v/[token] URL; when set, a QR block is drawn at the end. */
  verifyUrl?: string | null;
  /** Ф6 — pre-formatted control-visit line ("через 10 дн. · ≈ 20.06.2026"). */
  followUpLine?: string | null;
  locale?: "ru" | "uz";
  generatedAt?: Date;
  brandColor?: string | null;
}

const LABELS = {
  ru: {
    title: "Памятка для пациента",
    patient: "Пациент",
    doctor: "Врач",
    visitDate: "Дата приёма",
    generated: "Подготовлено",
    grid: "Схема приёма",
    followUp: "Контрольный визит",
    verify: "Проверка подлинности документа — отсканируйте QR-код",
  },
  uz: {
    title: "Bemor uchun eslatma",
    patient: "Bemor",
    doctor: "Shifokor",
    visitDate: "Tashrif sanasi",
    generated: "Tayyorlandi",
    grid: "Qabul jadvali",
    followUp: "Nazorat tashrifi",
    verify: "Hujjat haqiqiyligini tekshirish — QR kodni skanerlang",
  },
} as const;

let fontBytesPromise: Promise<Buffer> | null = null;
async function loadDejaVuSans(): Promise<Buffer> {
  if (!fontBytesPromise) {
    const fontPath = path.join(
      process.cwd(),
      "src",
      "server",
      "fonts",
      "DejaVuSans.ttf",
    );
    fontBytesPromise = fs.readFile(fontPath);
  }
  return fontBytesPromise;
}

function sanitizeBrand(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#3DD5C0";
}

function formatGeneratedAt(d: Date, locale: "ru" | "uz"): string {
  try {
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn-UZ" : "ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    // Some ICU builds lack uz-Latn — fall back to a stable ru-RU rendering.
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  }
}

/** Render the patient handout to a fully-buffered PDF. */
export async function renderConclusionPdf(
  input: ConclusionPdfInput,
): Promise<Buffer> {
  const locale = input.locale === "uz" ? "uz" : "ru";
  const labels = LABELS[locale];
  const brand = sanitizeBrand(input.brandColor);
  const generatedAt = input.generatedAt ?? new Date();
  const fontBytes = await loadDejaVuSans();

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margins: { top: 56, left: 56, right: 56, bottom: 56 },
    info: {
      Title: `${labels.title} — ${input.patientName}`,
      Author: input.clinicName,
      Creator: "NeuroFax",
    },
  });

  // Register + select DejaVuSans before any text so pdfkit never touches the
  // Latin-only Helvetica .afm (which would also break in a bundled runtime).
  doc.registerFont("body", fontBytes);
  doc.font("body");

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finalised = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - left - doc.page.margins.right;

  // Clinic header.
  doc.fontSize(15).fillColor("#1a1f2e").text(input.clinicName, { width: usableWidth });
  const clinicMeta = [input.clinicAddress, input.clinicPhone]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join("  ·  ");
  if (clinicMeta) {
    doc.moveDown(0.15);
    doc.fontSize(9).fillColor("#666").text(clinicMeta, { width: usableWidth });
  }

  // Brand accent rule.
  doc.moveDown(0.5);
  doc.rect(left, doc.y, usableWidth, 2).fill(brand);
  doc.moveDown(0.8);

  // Document title.
  doc.fontSize(18).fillColor(brand).text(labels.title, left, doc.y, {
    width: usableWidth,
  });
  doc.moveDown(0.5);

  // Meta (label: value) lines.
  const metaLine = (key: string, value: string) => {
    doc.fontSize(10).fillColor("#525866").text(`${key}: `, { continued: true });
    doc.fillColor("#1a1f2e").text(value);
  };
  if (input.documentNumber) metaLine("№", input.documentNumber);
  metaLine(labels.patient, input.patientName);
  if (input.doctorName) metaLine(labels.doctor, input.doctorName);
  metaLine(labels.visitDate, input.visitDateLabel);
  doc.moveDown(0.8);

  // Handout body — block by block, inline markers flattened to plain text.
  const blocks = parseHandoutBlocks(input.handoutMarkdown);
  for (const block of blocks) {
    if (block.kind === "h1") {
      doc.moveDown(0.3);
      doc
        .fontSize(15)
        .fillColor("#1a1f2e")
        .text(stripInlineMarkers(block.text), { width: usableWidth });
      doc.moveDown(0.15);
    } else if (block.kind === "h2") {
      doc.moveDown(0.25);
      doc
        .fontSize(12)
        .fillColor("#1a1f2e")
        .text(stripInlineMarkers(block.text), { width: usableWidth });
      doc.moveDown(0.1);
    } else if (block.kind === "bullets") {
      for (const item of block.items) {
        doc
          .fontSize(11)
          .fillColor("#1a1f2e")
          .text(`•  ${stripInlineMarkers(item)}`, {
            width: usableWidth,
            indent: 6,
          });
      }
      doc.moveDown(0.25);
    } else {
      doc
        .fontSize(11)
        .fillColor("#1a1f2e")
        .text(stripInlineMarkers(block.text), { width: usableWidth });
      doc.moveDown(0.35);
    }
  }

  // Ф5 — medication intake grid (shared model with the print route).
  const gridRows = input.prescriptions ?? [];
  if (gridRows.length > 0) {
    const grid = buildMedicationGrid(gridRows, locale);
    const bottomY = () => doc.page.height - doc.page.margins.bottom;
    const cols: Array<{ w: number; align: "left" | "center" }> = [
      { w: usableWidth * 0.34, align: "left" },
      ...grid.headers.times.map(() => ({
        w: usableWidth * 0.09,
        align: "center" as const,
      })),
      { w: usableWidth * 0.16, align: "left" },
      { w: usableWidth * 0.14, align: "left" },
    ];

    const drawGridRow = (
      texts: string[],
      note: string,
      header: boolean,
    ): void => {
      const size = header ? 8 : 9;
      doc.fontSize(size);
      let maxH = 0;
      texts.forEach((t, i) => {
        const h = doc.heightOfString(t || " ", { width: cols[i].w - 6 });
        if (h > maxH) maxH = h;
      });
      let noteH = 0;
      if (note) {
        doc.fontSize(7.5);
        noteH = doc.heightOfString(note, { width: cols[0].w - 6 }) + 1;
      }
      const rowH = maxH + noteH + 6;
      if (doc.y + rowH > bottomY()) doc.addPage();
      const y = doc.y;
      let x = left;
      texts.forEach((t, i) => {
        doc
          .fontSize(size)
          .fillColor(header ? "#525866" : "#1a1f2e")
          .text(t, x + 3, y, { width: cols[i].w - 6, align: cols[i].align });
        x += cols[i].w;
      });
      if (note) {
        doc
          .fontSize(7.5)
          .fillColor("#666")
          .text(note, left + 3, y + maxH + 1, { width: cols[0].w - 6 });
      }
      const lineY = y + rowH - 2;
      doc
        .moveTo(left, lineY)
        .lineTo(left + usableWidth, lineY)
        .strokeColor(header ? "#9aa0ab" : "#e3e6ea")
        .lineWidth(header ? 0.8 : 0.5)
        .stroke();
      doc.y = lineY + 4;
      doc.x = left;
    };

    doc.moveDown(0.4);
    if (doc.y + 60 > bottomY()) doc.addPage();
    doc
      .fontSize(12)
      .fillColor("#1a1f2e")
      .text(labels.grid, left, doc.y, { width: usableWidth });
    doc.moveDown(0.3);
    drawGridRow(
      [
        grid.headers.drug,
        ...grid.headers.times,
        grid.headers.meal,
        grid.headers.duration,
      ],
      "",
      true,
    );
    for (const row of grid.rows) {
      drawGridRow(
        [row.name, ...row.cells, row.meal, row.duration],
        row.note,
        false,
      );
    }
  }

  // Ф6 — control-visit line (date only; the reception note stays internal).
  if (input.followUpLine && input.followUpLine.trim()) {
    doc.moveDown(0.5);
    if (doc.y + 36 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    doc
      .fontSize(12)
      .fillColor("#1a1f2e")
      .text(labels.followUp, left, doc.y, { width: usableWidth });
    doc.moveDown(0.1);
    doc
      .fontSize(11)
      .fillColor("#1a1f2e")
      .text(input.followUpLine.trim(), left, doc.y, { width: usableWidth });
  }

  // Ф5 — QR verification block (public, PII-free /v/[token] page).
  if (input.verifyUrl) {
    const qrPng = await QRCode.toBuffer(input.verifyUrl, {
      margin: 0,
      width: 256,
      errorCorrectionLevel: "M",
    });
    const qrSize = 56;
    doc.moveDown(0.8);
    if (doc.y + qrSize + 16 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const qrY = doc.y;
    doc.image(qrPng, left + usableWidth - qrSize, qrY, {
      width: qrSize,
      height: qrSize,
    });
    doc
      .fontSize(8)
      .fillColor("#525866")
      .text(labels.verify, left, qrY + 4, {
        width: usableWidth - qrSize - 12,
      });
    doc
      .fontSize(7.5)
      .fillColor("#8b909b")
      .text(input.verifyUrl, left, doc.y + 2, {
        width: usableWidth - qrSize - 12,
      });
    doc.y = Math.max(doc.y, qrY + qrSize);
    doc.x = left;
  }

  // Footer.
  doc.moveDown(1.2);
  doc
    .fontSize(8)
    .fillColor("#8b909b")
    .text(
      `${labels.generated}: ${formatGeneratedAt(generatedAt, locale)}  ·  ${input.clinicName}`,
      left,
      doc.y,
      { width: usableWidth },
    );

  doc.end();
  return finalised;
}
