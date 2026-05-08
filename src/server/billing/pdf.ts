/**
 * Phase 19 Wave 3 — invoice PDF formatter.
 *
 * Mirrors the analytics PDF in `src/server/analytics/pdf.ts` — same
 * DejaVuSans embed pattern, same Buffer-on-end promise. One page,
 * portrait. Bilingual RU + UZ headers per Wave-3 brief.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import PDFDocument from "pdfkit";

export interface InvoicePdfInput {
  invoice: {
    id: string;
    number: string;
    status: string;
    amountTiins: bigint;
    currency: string;
    periodStart: Date;
    periodEnd: Date;
    dueAt: Date;
    paidAt: Date | null;
    paymentRef: string | null;
  };
  clinic: { nameRu: string; nameUz: string };
  plan: { slug: string; nameRu: string; nameUz: string };
}

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

function formatTiinsAsUzs(value: bigint): string {
  const minor = Number(value);
  const whole = Math.trunc(minor / 100);
  const sign = whole < 0 ? "-" : "";
  const abs = Math.abs(whole).toString();
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} UZS`;
}

function fmtDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Render a one-page invoice PDF. Bilingual (RU + UZ) header lines and
 * field labels. Single-line item — the upgrade product.
 */
export async function formatInvoicePdf(
  input: InvoicePdfInput,
): Promise<Buffer> {
  const fontBytes = await loadDejaVuSans();

  const doc = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margins: { top: 56, left: 48, right: 48, bottom: 56 },
    info: {
      Title: `Invoice ${input.invoice.number}`,
      Author: input.clinic.nameRu,
      Creator: "NeuroFax CRM",
    },
  });

  doc.registerFont("body", fontBytes);
  doc.font("body");

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finalised = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const top = doc.page.margins.top;
  const usableWidth = pageWidth - left - right;

  // Header: clinic name RU + UZ.
  doc.fontSize(11).fillColor("#666").text(input.clinic.nameRu, left, top);
  doc.fontSize(10).fillColor("#888").text(input.clinic.nameUz, left, doc.y);
  doc.moveDown(0.6);

  // Title block.
  doc
    .fontSize(20)
    .fillColor("#111")
    .text(`Счёт / Hisob-faktura ${input.invoice.number}`, left, doc.y, {
      width: usableWidth,
    });
  doc.moveDown(0.2);
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(
      `Статус / Holat: ${input.invoice.status}`,
      { width: usableWidth },
    );
  doc.moveDown(0.6);

  // Field grid — labels on left, values on right.
  const labelX = left;
  const valueX = left + 220;
  const lineGap = 4;

  const writeLine = (label: string, value: string) => {
    const y = doc.y;
    doc.fontSize(10).fillColor("#555").text(label, labelX, y, {
      width: 200,
      lineBreak: false,
    });
    doc.fontSize(10).fillColor("#111").text(value, valueX, y, {
      width: usableWidth - (valueX - left),
      lineBreak: false,
    });
    doc.y = y + 14 + lineGap;
  };

  writeLine(
    "Период / Davr:",
    `${fmtDateIso(input.invoice.periodStart)} — ${fmtDateIso(input.invoice.periodEnd)}`,
  );
  writeLine(
    "Срок оплаты / To'lov muddati:",
    fmtDateIso(input.invoice.dueAt),
  );
  writeLine(
    "Тариф / Tarif (RU):",
    `${input.plan.nameRu} (${input.plan.slug})`,
  );
  writeLine(
    "Тариф / Tarif (UZ):",
    `${input.plan.nameUz} (${input.plan.slug})`,
  );
  if (input.invoice.paidAt) {
    writeLine(
      "Оплачено / To'langan:",
      fmtDateIso(input.invoice.paidAt),
    );
  }
  if (input.invoice.paymentRef) {
    writeLine("Ref:", input.invoice.paymentRef);
  }

  doc.moveDown(0.8);

  // Line item box.
  const boxY = doc.y;
  const boxH = 60;
  doc
    .rect(left, boxY, usableWidth, boxH)
    .fillColor("#f3f4f6")
    .fill();

  const innerY = boxY + 10;
  doc
    .fontSize(11)
    .fillColor("#111")
    .text(
      `Подписка ${input.plan.nameRu} / ${input.plan.nameUz} obunasi`,
      left + 12,
      innerY,
      { width: usableWidth - 24, lineBreak: false },
    );
  doc
    .fontSize(10)
    .fillColor("#666")
    .text(
      `${fmtDateIso(input.invoice.periodStart)} — ${fmtDateIso(input.invoice.periodEnd)}`,
      left + 12,
      innerY + 16,
      { width: usableWidth / 2, lineBreak: false },
    );
  doc
    .fontSize(14)
    .fillColor("#111")
    .text(formatTiinsAsUzs(input.invoice.amountTiins), left, innerY + 12, {
      width: usableWidth - 12,
      align: "right",
      lineBreak: false,
    });

  doc.y = boxY + boxH + 16;

  // Total.
  doc
    .fontSize(11)
    .fillColor("#555")
    .text("Итого / Jami:", left, doc.y, {
      width: usableWidth - 200,
      lineBreak: false,
    });
  doc
    .fontSize(14)
    .fillColor("#111")
    .text(formatTiinsAsUzs(input.invoice.amountTiins), left, doc.y, {
      width: usableWidth,
      align: "right",
      lineBreak: false,
    });

  // Footer.
  const footerY = doc.page.height - doc.page.margins.bottom + 12;
  doc
    .fontSize(9)
    .fillColor("#888")
    .text("neurofax.uz — MedBook CRM", left, footerY, {
      width: usableWidth,
      align: "center",
      lineBreak: false,
    });

  doc.end();
  return finalised;
}

export function invoicePdfFilename(number: string): string {
  const safe = number.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safe}.pdf`;
}
