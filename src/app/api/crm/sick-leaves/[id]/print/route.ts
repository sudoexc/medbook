/**
 * GET /api/crm/sick-leaves/[id]/print — printable sick-leave certificate.
 *
 * Mirrors the Rx print route. The QR encodes the public verify URL so HR
 * or the employer can confirm authenticity. Cancelled certificates render
 * a giant НЕ ДЕЙСТВИТЕЛЕН banner.
 *
 * Stamps `printedAt` + audits `SICK_LEAVE_PRINTED` on first GET.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import QRCode from "qrcode";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return new Response("Forbidden", { status: 403 });

    const id = idFromUrl(request.url);
    if (!id) return new Response("Bad request", { status: 400 });

    const sl = await prisma.sickLeave.findFirst({
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
    if (!sl) return new Response("Not found", { status: 404 });
    if (ctx.role === "DOCTOR" && sl.doctorId !== ctx.userId) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!sl.printedAt && sl.status === "ISSUED") {
      await prisma.sickLeave.update({
        where: { id: sl.id },
        data: { printedAt: new Date() },
      });
      await audit(request, {
        action: AUDIT_ACTION.SICK_LEAVE_PRINTED,
        entityType: "SickLeave",
        entityId: sl.id,
        meta: { certNumber: sl.certNumber, printedAt: new Date().toISOString() },
      });
    }

    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
      new URL(request.url).origin;
    const verifyUrl = `${base}/api/verify/sick-leave/${sl.verifyToken}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 140,
      errorCorrectionLevel: "M",
    });

    return new Response(
      renderHtml({
        sl: {
          certNumber: sl.certNumber,
          diagnosisCode: sl.diagnosisCode,
          diagnosisName: sl.diagnosisName,
          regimen: sl.regimen,
          periodFrom: sl.periodFrom,
          periodTo: sl.periodTo,
          restrictions: sl.restrictions,
          notes: sl.notes,
          issuedAt: sl.issuedAt,
          signatureUrl: sl.signatureUrl,
          status: sl.status,
        },
        patient: sl.patient,
        doctor: sl.doctor,
        clinic: sl.clinic,
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
  const m = /\/sick-leaves\/([^/]+)\/print/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

type SlView = {
  certNumber: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  regimen: "OUTPATIENT" | "HOSPITAL" | "HOME";
  periodFrom: Date;
  periodTo: Date;
  restrictions: string | null;
  notes: string | null;
  issuedAt: Date;
  signatureUrl: string | null;
  status: "ISSUED" | "CANCELLED";
};

function renderHtml({
  sl,
  patient,
  doctor,
  clinic,
  qrDataUrl,
  verifyUrl,
}: {
  sl: SlView;
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
  const dateStr = sl.issuedAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const fromStr = sl.periodFrom.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const toStr = sl.periodTo.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const days =
    Math.round(
      (sl.periodTo.getTime() - sl.periodFrom.getTime()) / 86400000,
    ) + 1;

  const regimenLabel =
    sl.regimen === "HOSPITAL"
      ? "Стационар"
      : sl.regimen === "HOME"
        ? "Постельный режим"
        : "Амбулаторно";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`Лист нетрудоспособности ${sl.certNumber}`)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; font-size: 11pt; }
  body { padding: 18px; }
  h1 { font-size: 16pt; margin: 0; }
  h2 { font-size: 11pt; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .header-left .sub { font-size: 9pt; color: #555; margin-top: 2px; }
  .header-right { text-align: right; }
  .qr img { display: block; }
  .order-number { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 10pt; margin-top: 4px; color: #222; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 12px; font-size: 10pt; }
  .grid .lbl { color: #777; font-size: 9pt; }
  .period { background: #f4f6fb; border-left: 4px solid #345; padding: 12px 14px; margin: 16px 0; font-size: 13pt; }
  .period .days { font-size: 11pt; color: #555; margin-top: 4px; }
  .signature { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; font-size: 10pt; }
  .signature-img { max-height: 56px; max-width: 220px; display: block; margin: 0 auto 4px; }
  .signature .line { border-bottom: 1px solid #888; padding-top: 28px; }
  .footer { margin-top: 30px; font-size: 8.5pt; color: #888; text-align: center; }
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
      <h2 style="margin-top: 14px; border-bottom: none; padding-bottom: 0;">Лист временной нетрудоспособности</h2>
    </div>
    <div class="header-right">
      <div class="qr"><img src="${qrDataUrl}" width="120" height="120" alt="QR ${escapeHtml(sl.certNumber)}"></div>
      <div class="order-number">№ ${escapeHtml(sl.certNumber)}</div>
      <div class="order-number">${escapeHtml(dateStr)}</div>
      <div class="verify-hint">Проверка подлинности по QR на ${escapeHtml(new URL(verifyUrl).host)}</div>
    </div>
  </div>

  ${sl.status === "CANCELLED" ? `<div class="cancelled-banner">⚠ ЛИСТ АННУЛИРОВАН — НЕДЕЙСТВИТЕЛЕН</div>` : ""}

  <div class="grid">
    <div><span class="lbl">ФИО:</span> <b>${escapeHtml(patient.fullName)}</b></div>
    <div><span class="lbl">Дата рождения:</span> ${patient.birthDate ? escapeHtml(patient.birthDate.toLocaleDateString("ru-RU")) : "—"}</div>
    <div><span class="lbl">Пол:</span> ${patient.gender === "M" ? "мужской" : patient.gender === "F" ? "женский" : "—"}</div>
    <div><span class="lbl">Телефон:</span> ${escapeHtml(patient.phoneNormalized)}</div>
    <div><span class="lbl">МКБ-10:</span> ${sl.diagnosisCode ? escapeHtml(sl.diagnosisCode) + (sl.diagnosisName ? " · " + escapeHtml(sl.diagnosisName) : "") : "—"}</div>
    <div><span class="lbl">Режим:</span> <b>${escapeHtml(regimenLabel)}</b></div>
  </div>

  <div class="period">
    <div><b>Освобождён(а) от работы</b> с ${escapeHtml(fromStr)} по ${escapeHtml(toStr)}</div>
    <div class="days">Календарных дней: ${days}</div>
  </div>

  ${
    sl.restrictions
      ? `<h2>Рекомендации / ограничения</h2><div style="white-space: pre-wrap; font-size: 10pt;">${escapeHtml(sl.restrictions)}</div>`
      : ""
  }

  ${
    sl.notes
      ? `<h2>Примечания</h2><div style="white-space: pre-wrap; font-size: 10pt;">${escapeHtml(sl.notes)}</div>`
      : ""
  }

  <div class="signature">
    <div>
      ${sl.signatureUrl ? `<img class="signature-img" src="${escapeHtml(sl.signatureUrl)}" alt="Подпись"/>` : ""}
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
    Сгенерировано MedBook · ${escapeHtml(sl.certNumber)} · ${escapeHtml(dateStr)}
  </div>

  <script>
    setTimeout(function() { window.print(); }, 250);
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
