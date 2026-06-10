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

import {
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
  },
  uz: {
    title: "Bemor uchun eslatma",
    patient: "Bemor",
    doctor: "Shifokor",
    visitDate: "Tashrif sanasi",
    generated: "Tayyorlandi",
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

  // Footer.
  doc.moveDown(1.2);
  doc
    .fontSize(8)
    .fillColor("#8b909b")
    .text(
      `${labels.generated}: ${formatGeneratedAt(generatedAt, locale)}  ·  ${input.clinicName}`,
      { width: usableWidth },
    );

  doc.end();
  return finalised;
}
