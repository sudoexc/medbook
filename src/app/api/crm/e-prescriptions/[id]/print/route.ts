/**
 * GET /api/crm/e-prescriptions/[id]/print — printable Rx as standalone HTML.
 *
 * A4 single page (or two if the items list overflows), `window.print()` on
 * load. The QR encodes the public verify URL so a pharmacist with a phone
 * can confirm authenticity without CRM credentials. Doctor signature image
 * (snapshotted at issue time) appears above the typed name; if absent the
 * page falls back to a printed-name-only signature line.
 *
 * Stamps `printedAt` on first GET and emits `EPRESCRIPTION_PRINTED`.
 * Re-prints don't audit again.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import QRCode from "qrcode";

import type { RxItem } from "@/server/schemas/clinical-forms";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return new Response("Forbidden", { status: 403 });

    const id = idFromUrl(request.url);
    if (!id) return new Response("Bad request", { status: 400 });

    const rx = await prisma.ePrescription.findFirst({
      where: { id, clinicId: ctx.clinicId },
      include: {
        patient: {
          select: {
            fullName: true,
            birthDate: true,
            gender: true,
            phoneNormalized: true,
          },
        },
        doctor: { select: { name: true, phone: true } },
        clinic: {
          select: {
            nameRu: true,
            phone: true,
            addressRu: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!rx) return new Response("Not found", { status: 404 });
    if (ctx.role === "DOCTOR" && rx.doctorId !== ctx.userId) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!rx.printedAt && rx.status === "ISSUED") {
      await prisma.ePrescription.update({
        where: { id: rx.id },
        data: { printedAt: new Date() },
      });
      await audit(request, {
        action: AUDIT_ACTION.EPRESCRIPTION_PRINTED,
        entityType: "EPrescription",
        entityId: rx.id,
        meta: { rxNumber: rx.rxNumber, printedAt: new Date().toISOString() },
      });
    }

    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
      new URL(request.url).origin;
    const verifyUrl = `${base}/api/verify/recipe/${rx.verifyToken}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 140,
      errorCorrectionLevel: "M",
    });

    return new Response(
      renderHtml({
        rx: {
          rxNumber: rx.rxNumber,
          diagnosisCode: rx.diagnosisCode,
          diagnosisName: rx.diagnosisName,
          notes: rx.notes,
          items: Array.isArray(rx.items) ? (rx.items as RxItem[]) : [],
          issuedAt: rx.issuedAt,
          validUntilAt: rx.validUntilAt,
          signatureUrl: rx.signatureUrl,
          status: rx.status,
        },
        patient: rx.patient,
        doctor: rx.doctor,
        clinic: rx.clinic,
        qrDataUrl,
        verifyUrl,
      }),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  },
);

function idFromUrl(url: string): string | null {
  const m = /\/e-prescriptions\/([^/]+)\/print/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

type RxView = {
  rxNumber: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  notes: string | null;
  items: RxItem[];
  issuedAt: Date;
  validUntilAt: Date;
  signatureUrl: string | null;
  status: "ISSUED" | "CANCELLED";
};

function renderHtml({
  rx,
  patient,
  doctor,
  clinic,
  qrDataUrl,
  verifyUrl,
}: {
  rx: RxView;
  patient: {
    fullName: string;
    birthDate: Date | null;
    gender: string | null;
    phoneNormalized: string;
  };
  doctor: { name: string; phone: string | null };
  clinic: {
    nameRu: string;
    phone: string | null;
    addressRu: string | null;
    logoUrl: string | null;
  };
  qrDataUrl: string;
  verifyUrl: string;
}): string {
  const dateStr = rx.issuedAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const validUntilStr = rx.validUntilAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const dob = patient.birthDate
    ? patient.birthDate.toLocaleDateString("ru-RU")
    : "—";
  const age = patient.birthDate ? `${calcAge(patient.birthDate)} лет` : "—";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`Рецепт ${rx.rxNumber}`)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; font-size: 11pt; }
  body { padding: 18px; }
  h1 { font-size: 16pt; margin: 0; }
  h2 { font-size: 11pt; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 5px 8px; vertical-align: top; }
  thead th { font-size: 9pt; color: #666; border-bottom: 1px solid #ccc; font-weight: 600; }
  tbody tr { border-bottom: 1px dotted #eee; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .header-left .sub { font-size: 9pt; color: #555; margin-top: 2px; }
  .header-right { text-align: right; }
  .qr img { display: block; }
  .order-number { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 10pt; margin-top: 4px; color: #222; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 12px; font-size: 10pt; }
  .grid .lbl { color: #777; font-size: 9pt; }
  .signature { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; font-size: 10pt; }
  .signature-img { max-height: 56px; max-width: 220px; display: block; margin: 0 auto 4px; }
  .signature .line { border-bottom: 1px solid #888; padding-top: 28px; }
  .footer { margin-top: 30px; font-size: 8.5pt; color: #888; text-align: center; }
  .item-name { font-weight: 600; font-size: 11pt; }
  .item-meta { color: #555; font-size: 9.5pt; margin-top: 2px; }
  .item-instructions { color: #333; font-size: 10pt; margin-top: 4px; font-style: italic; }
  .cancelled-banner { background: #fee; border: 2px solid #c00; color: #900; padding: 10px; text-align: center; font-weight: 700; margin: 14px 0; font-size: 13pt; }
  .verify-hint { font-size: 8.5pt; color: #777; text-align: right; margin-top: 6px; max-width: 160px; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${escapeHtml(clinic.nameRu)}</h1>
      <div class="sub">
        ${clinic.addressRu ? escapeHtml(clinic.addressRu) : ""}
        ${clinic.phone ? " · тел. " + escapeHtml(clinic.phone) : ""}
      </div>
      <h2 style="margin-top: 14px; border-bottom: none; padding-bottom: 0;">Рецепт</h2>
    </div>
    <div class="header-right">
      <div class="qr"><img src="${qrDataUrl}" width="120" height="120" alt="QR ${escapeHtml(rx.rxNumber)}"></div>
      <div class="order-number">№ ${escapeHtml(rx.rxNumber)}</div>
      <div class="order-number">${escapeHtml(dateStr)}</div>
      <div class="verify-hint">Проверка подлинности по QR на ${escapeHtml(new URL(verifyUrl).host)}</div>
    </div>
  </div>

  ${rx.status === "CANCELLED" ? `<div class="cancelled-banner">⚠ РЕЦЕПТ ОТМЕНЁН — НЕ ВЫДАВАТЬ</div>` : ""}

  <div class="grid">
    <div><span class="lbl">Пациент:</span> <b>${escapeHtml(patient.fullName)}</b></div>
    <div><span class="lbl">Дата рождения:</span> ${escapeHtml(dob)} (${escapeHtml(age)})</div>
    <div><span class="lbl">Пол:</span> ${patient.gender === "M" ? "мужской" : patient.gender === "F" ? "женский" : "—"}</div>
    <div><span class="lbl">Телефон:</span> ${escapeHtml(patient.phoneNormalized)}</div>
    <div><span class="lbl">МКБ-10:</span> ${rx.diagnosisCode ? escapeHtml(rx.diagnosisCode) + (rx.diagnosisName ? " · " + escapeHtml(rx.diagnosisName) : "") : "—"}</div>
    <div><span class="lbl">Действителен до:</span> <b>${escapeHtml(validUntilStr)}</b></div>
  </div>

  <h2>Назначения (Rp.)</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 28px;">№</th>
        <th>Препарат / дозировка / схема</th>
      </tr>
    </thead>
    <tbody>
      ${rx.items
        .map(
          (it, i) => `<tr>
            <td style="vertical-align: top;">${i + 1}.</td>
            <td>
              <div class="item-name">${escapeHtml(it.drugName)}${it.dose ? " — " + escapeHtml(it.dose) : ""}</div>
              <div class="item-meta">
                ${it.frequency ? "По " + escapeHtml(it.frequency) : ""}
                ${it.route ? " · " + escapeHtml(it.route) : ""}
                ${it.durationDays ? " · в течение " + it.durationDays + " дн." : ""}
              </div>
              ${it.instructions ? `<div class="item-instructions">${escapeHtml(it.instructions)}</div>` : ""}
            </td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>

  ${
    rx.notes
      ? `<h2>Примечания</h2><div style="white-space: pre-wrap; font-size: 10pt;">${escapeHtml(rx.notes)}</div>`
      : ""
  }

  <div class="signature">
    <div>
      ${rx.signatureUrl ? `<img class="signature-img" src="${escapeHtml(rx.signatureUrl)}" alt="Подпись"/>` : ""}
      <div class="line"></div>
      <div style="text-align: center; color: #555; margin-top: 4px;">Подпись врача</div>
      <div style="text-align: center; font-size: 9pt; color: #888;">${escapeHtml(doctor.name)}</div>
    </div>
    <div>
      <div class="line"></div>
      <div style="text-align: center; color: #555; margin-top: 4px;">Печать клиники</div>
    </div>
  </div>

  <div class="footer">
    Сгенерировано MedBook · ${escapeHtml(rx.rxNumber)} · ${escapeHtml(dateStr)}
  </div>

  <script>
    setTimeout(function() { window.print(); }, 250);
  </script>
</body>
</html>`;
}

function calcAge(birthDate: Date): number {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
