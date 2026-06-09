/**
 * P2.1 — Clinical referral (направление) → PDF.
 *
 * Renders a single-page A4 referral the patient carries to the next clinic and
 * also sees in the Mini App documents list. Unlike the visit-note conclusion
 * there is no markdown body — `reason` is plain doctor-authored prose — so we
 * skip the block parser and lay out a short structured sheet: who referred whom
 * to where, the ICD-10 snapshot, and the reason.
 *
 * Same pdfkit + DejaVuSans rationale as `conclusion-pdf.ts` (pure JS, Cyrillic
 * + Uzbek-Latin glyph coverage, register the font before any text so pdfkit
 * never falls back to Latin-only Helvetica). The font loader is duplicated here
 * to keep this module independent of the conclusion/analytics export paths.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

export interface ReferralPdfInput {
  clinicName: string;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  /** Authoring doctor, localised by the caller. */
  fromDoctorName?: string | null;
  /** Resolved destination — internal colleague's name OR external free text. */
  toLabel: string;
  patientName: string;
  /** Pre-formatted referral date, localised by the caller. */
  dateLabel: string;
  diagnosisCode?: string | null;
  diagnosisName?: string | null;
  reason: string;
  locale?: "ru" | "uz";
  generatedAt?: Date;
  brandColor?: string | null;
}

const LABELS = {
  ru: {
    title: "Направление",
    patient: "Пациент",
    doctor: "Направил",
    to: "Направлен(а) к",
    diagnosis: "Диагноз",
    date: "Дата",
    reason: "Причина направления",
    generated: "Подготовлено",
  },
  uz: {
    title: "Yo‘llanma",
    patient: "Bemor",
    doctor: "Yo‘llagan",
    to: "Yo‘llanmoqda",
    diagnosis: "Tashxis",
    date: "Sana",
    reason: "Yo‘llanma sababi",
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

/** Render the referral to a fully-buffered PDF. */
export async function renderReferralPdf(input: ReferralPdfInput): Promise<Buffer> {
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
  metaLine(labels.patient, input.patientName);
  if (input.fromDoctorName) metaLine(labels.doctor, input.fromDoctorName);
  metaLine(labels.to, input.toLabel);
  const diagnosis = [input.diagnosisCode, input.diagnosisName]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join(" — ");
  if (diagnosis) metaLine(labels.diagnosis, diagnosis);
  metaLine(labels.date, input.dateLabel);
  doc.moveDown(0.8);

  // Reason — plain prose.
  doc.fontSize(12).fillColor("#1a1f2e").text(labels.reason, { width: usableWidth });
  doc.moveDown(0.2);
  doc.fontSize(11).fillColor("#1a1f2e").text(input.reason.trim(), {
    width: usableWidth,
  });

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
