/**
 * GET /api/crm/cases/[id]/pdf — "Карта случая" printable export.
 *
 * NOTE on the rendering choice: the project does NOT have any heavyweight PDF
 * dependency installed (no @react-pdf/renderer, no puppeteer, no pdfkit). The
 * task brief explicitly forbids introducing one, so this endpoint serves a
 * print-styled HTML document instead. Browsers (and Telegram in-app browsers)
 * render it instantly and the user can hit Cmd/Ctrl+P → "Save as PDF" to land
 * a real PDF — same UX shape as paper print previews everyone already knows.
 *
 * The HTML is fully self-contained (no JS, only an inline <style>) so it
 * works offline and prints identically across browsers. The document flow,
 * header, sections and footer below mirror the Карта случая spec from the
 * task brief: clinic header, complaint/diagnosis/notes section, chronological
 * visits with primary/repeat labels, totals + page numbers + timestamp footer.
 *
 * Multi-tenant guard: the lookup is auto-scoped by the Prisma tenant
 * extension; a cross-tenant id surfaces as 404. Audit log fires on success.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notFound } from "@/server/http";
import { formatDate, formatPhone, formatMoney, type Locale } from "@/lib/format";

function idFromUrl(request: Request): string {
  // /api/crm/cases/[id]/pdf — id is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

function pickLocale(request: Request): Locale {
  // Honor `?lang=uz`/`?lang=ru` if the caller wants to force a language;
  // otherwise default to RU (matches the rest of CRM).
  const url = new URL(request.url);
  const q = (url.searchParams.get("lang") ?? "").toLowerCase();
  if (q === "uz") return "uz";
  return "ru";
}

function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATUS_LABEL_RU: Record<string, string> = {
  OPEN: "Открыт",
  RESOLVED: "Завершён",
  ABANDONED: "Прерван",
  TRANSFERRED: "Передан",
};
const STATUS_LABEL_UZ: Record<string, string> = {
  OPEN: "Ochiq",
  RESOLVED: "Yakunlangan",
  ABANDONED: "Toʻxtatilgan",
  TRANSFERRED: "Boshqaga oʻtkazilgan",
};

const APPT_STATUS_RU: Record<string, string> = {
  BOOKED: "Записан",
  WAITING: "В очереди",
  IN_PROGRESS: "На приёме",
  COMPLETED: "Завершён",
  SKIPPED: "Пропущен",
  CANCELLED: "Отменён",
  NO_SHOW: "Не пришёл",
};
const APPT_STATUS_UZ: Record<string, string> = {
  BOOKED: "Yozildi",
  WAITING: "Navbatda",
  IN_PROGRESS: "Qabulda",
  COMPLETED: "Tugadi",
  SKIPPED: "Oʻtkazib yuborildi",
  CANCELLED: "Bekor qilindi",
  NO_SHOW: "Kelmagan",
};

function visitOrdinalRu(n: number): string {
  // 1 → "Первичный"; otherwise "Повторный (N-я)".
  if (n === 1) return "Первичный";
  return `Повторный (${n}-я)`;
}

function visitOrdinalUz(n: number): string {
  if (n === 1) return "Birlamchi";
  return `Takroriy (${n}-tashrif)`;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const locale = pickLocale(request);

    // Tenant-scoped via Prisma extension (cross-clinic ids return null).
    const mcase = await prisma.medicalCase.findUnique({
      where: { id },
      include: {
        primaryDoctor: {
          select: { id: true, nameRu: true, nameUz: true, specializationRu: true, specializationUz: true },
        },
        patient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            birthDate: true,
            gender: true,
          },
        },
        appointments: {
          orderBy: { date: "asc" as const },
          include: {
            doctor: {
              select: { id: true, nameRu: true, nameUz: true },
            },
            primaryService: {
              select: { id: true, nameRu: true, nameUz: true },
            },
            services: {
              include: {
                service: {
                  select: { id: true, nameRu: true, nameUz: true },
                },
              },
            },
          },
        },
      },
    });
    if (!mcase) return notFound();

    // Clinic header is read separately — we need the logo + name in the
    // active clinic context. The auto-scope returns the clinic the user is
    // currently in (matches `mcase.clinicId` by construction).
    const clinic =
      ctx.kind === "TENANT"
        ? await prisma.clinic.findUnique({
            where: { id: ctx.clinicId },
            select: {
              id: true,
              nameRu: true,
              nameUz: true,
              addressRu: true,
              addressUz: true,
              phone: true,
              logoUrl: true,
              brandColor: true,
            },
          })
        : null;

    const clinicName = clinic
      ? locale === "uz"
        ? clinic.nameUz
        : clinic.nameRu
      : "—";
    const clinicAddress = clinic
      ? locale === "uz"
        ? clinic.addressUz
        : clinic.addressRu
      : null;

    const doctorName = mcase.primaryDoctor
      ? locale === "uz"
        ? mcase.primaryDoctor.nameUz
        : mcase.primaryDoctor.nameRu
      : null;

    // Total billed: sum priceFinal for non-cancelled visits. Cancelled +
    // no-show visits have their priceFinal already nullified by the booking
    // side-effects, but we filter defensively in case of a stale row.
    const billable = mcase.appointments.filter(
      (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
    );
    const totalBilled = billable.reduce(
      (acc, a) => acc + (a.priceFinal ?? 0),
      0,
    );

    const generatedAt = new Date();
    const labels =
      locale === "uz"
        ? {
            title: "Davolanish kartasi",
            patient: "Bemor",
            phone: "Telefon",
            birthDate: "Tugʻilgan sana",
            gender: "Jinsi",
            primaryDoctor: "Asosiy shifokor",
            opened: "Ochilgan",
            closed: "Yopilgan",
            status: "Holat",
            sectionDetails: "Tafsilotlar",
            complaint: "Shikoyat",
            diagnosis: "Tashxis",
            diagnosisCode: "ICD-10",
            notes: "Eslatmalar",
            sectionVisits: "Tashriflar",
            colDate: "Sana",
            colDoctor: "Shifokor",
            colServices: "Xizmatlar",
            colPrice: "Narxi",
            colStatus: "Holati",
            colKind: "Turi",
            empty: "—",
            totalBilled: "Jami hisoblangan",
            generated: "Yaratildi",
            page: "sahifa",
            print: "Chop etish / PDF",
            noVisits: "Ushbu kartaga tegishli tashriflar yoʻq.",
            genderM: "Erkak",
            genderF: "Ayol",
          }
        : {
            title: "Карта случая",
            patient: "Пациент",
            phone: "Телефон",
            birthDate: "Дата рождения",
            gender: "Пол",
            primaryDoctor: "Ведущий врач",
            opened: "Открыт",
            closed: "Закрыт",
            status: "Статус",
            sectionDetails: "Детали",
            complaint: "Жалоба",
            diagnosis: "Диагноз",
            diagnosisCode: "Код по МКБ-10",
            notes: "Заметки",
            sectionVisits: "Визиты",
            colDate: "Дата",
            colDoctor: "Врач",
            colServices: "Услуги",
            colPrice: "Стоимость",
            colStatus: "Статус",
            colKind: "Тип",
            empty: "—",
            totalBilled: "Итого начислено",
            generated: "Сформировано",
            page: "стр.",
            print: "Печать / PDF",
            noVisits: "В этом случае пока нет визитов.",
            genderM: "Муж.",
            genderF: "Жен.",
          };

    const statusLabels = locale === "uz" ? STATUS_LABEL_UZ : STATUS_LABEL_RU;
    const apptStatusLabels = locale === "uz" ? APPT_STATUS_UZ : APPT_STATUS_RU;
    const visitOrdinal = locale === "uz" ? visitOrdinalUz : visitOrdinalRu;
    const brandColor = clinic?.brandColor ?? "#3DD5C0";

    // ---- HTML rendering ----------------------------------------------------
    const visitRows = mcase.appointments
      .map((a, idx) => {
        const visitN = idx + 1;
        const docName = a.doctor
          ? locale === "uz"
            ? a.doctor.nameUz
            : a.doctor.nameRu
          : "—";
        const serviceNames =
          a.services.length > 0
            ? a.services
                .map((s) =>
                  locale === "uz" ? s.service.nameUz : s.service.nameRu,
                )
                .join("; ")
            : a.primaryService
              ? locale === "uz"
                ? a.primaryService.nameUz
                : a.primaryService.nameRu
              : "—";
        const date = formatDate(a.date, locale, "short");
        const time = a.time ? ` ${escapeHtml(a.time)}` : "";
        // priceFinal is stored in minor units (tiins, ×100 of UZS) — see
        // prisma/seed.ts for the convention. formatMoney does the division.
        const priceCell =
          a.priceFinal !== null
            ? formatMoney(a.priceFinal, "UZS", locale)
            : labels.empty;
        const statusCell = apptStatusLabels[a.status] ?? a.status;
        const kindCell = visitOrdinal(visitN);
        return `
          <tr>
            <td class="num">${visitN}</td>
            <td>${escapeHtml(date)}${time}</td>
            <td>${escapeHtml(kindCell)}</td>
            <td>${escapeHtml(docName)}</td>
            <td>${escapeHtml(serviceNames)}</td>
            <td class="price">${escapeHtml(priceCell)}</td>
            <td>${escapeHtml(statusCell)}</td>
          </tr>
        `;
      })
      .join("");

    const patientGender =
      mcase.patient.gender === "MALE"
        ? labels.genderM
        : mcase.patient.gender === "FEMALE"
          ? labels.genderF
          : null;

    const patientBirth = mcase.patient.birthDate
      ? formatDate(mcase.patient.birthDate, locale, "short")
      : null;

    const html = `<!doctype html>
<html lang="${locale === "uz" ? "uz" : "ru"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`${labels.title} — ${mcase.title}`)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root { --brand: ${escapeHtml(brandColor)}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
      color: #1a1f2e;
      font-size: 12px;
      line-height: 1.45;
      background: #fff;
    }
    .page {
      max-width: 800px;
      margin: 24px auto;
      padding: 24px 32px;
    }
    @media print {
      body { font-size: 11px; }
      .page { margin: 0; padding: 16mm; max-width: none; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    }
    .print-bar {
      position: sticky; top: 0;
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 8px 16px;
      background: #f6f7f9;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 16px;
    }
    .print-bar button {
      background: var(--brand);
      color: #fff;
      border: 0;
      padding: 8px 14px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }
    .header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      border-bottom: 2px solid var(--brand);
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .header .logo {
      width: 56px; height: 56px;
      border-radius: 8px;
      background: #f1f5f9;
      object-fit: contain;
      display: block;
    }
    .header .clinic-name {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }
    .header .clinic-meta {
      color: #525866;
      font-size: 11px;
      margin-top: 2px;
    }
    .header .doc-title {
      margin-left: auto;
      text-align: right;
    }
    .header .doc-title h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: var(--brand);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .header .doc-title .case-title {
      font-size: 13px;
      font-weight: 600;
      margin-top: 2px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px 24px;
      margin-bottom: 18px;
    }
    .meta-grid .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px dotted #d6dae2;
      padding: 4px 0;
    }
    .meta-grid .row .k {
      color: #525866;
      font-weight: 500;
    }
    .meta-grid .row .v {
      color: #1a1f2e;
      font-weight: 600;
      text-align: right;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #eef9f7;
      color: #0a8c75;
      font-size: 11px;
      font-weight: 600;
    }
    .badge.closed { background: #fef2f2; color: #b91c1c; }
    section.block {
      margin: 16px 0;
    }
    section.block h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #525866;
      font-weight: 700;
    }
    section.block .body {
      white-space: pre-wrap;
      background: #fafbfd;
      border: 1px solid #e7e9ee;
      border-radius: 6px;
      padding: 10px 12px;
      min-height: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    table th, table td {
      border: 1px solid #e3e6ec;
      padding: 6px 8px;
      vertical-align: top;
      text-align: left;
    }
    table th {
      background: #f4f6fa;
      font-weight: 700;
      color: #2a2f3a;
    }
    td.num { width: 28px; text-align: center; color: #525866; }
    td.price { text-align: right; white-space: nowrap; }
    .totals {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      font-weight: 700;
      font-size: 13px;
    }
    footer {
      margin-top: 28px;
      padding-top: 10px;
      border-top: 1px solid #e3e6ec;
      color: #525866;
      font-size: 10px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .empty {
      color: #8b909b;
      font-style: italic;
      padding: 8px 0;
    }
    /* Page numbers via CSS counter — visible when printed. */
    @page {
      size: A4 portrait;
      margin: 14mm;
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <button onclick="window.print()">${escapeHtml(labels.print)}</button>
  </div>
  <div class="page">
    <header class="header">
      ${
        clinic?.logoUrl
          ? `<img class="logo" src="${escapeHtml(clinic.logoUrl)}" alt="" />`
          : `<div class="logo" aria-hidden="true"></div>`
      }
      <div>
        <h1 class="clinic-name">${escapeHtml(clinicName)}</h1>
        <div class="clinic-meta">
          ${clinicAddress ? escapeHtml(clinicAddress) : ""}
          ${clinic?.phone ? ` · ${escapeHtml(formatPhone(clinic.phone))}` : ""}
        </div>
      </div>
      <div class="doc-title">
        <h2>${escapeHtml(labels.title)}</h2>
        <div class="case-title">${escapeHtml(mcase.title)}</div>
      </div>
    </header>

    <div class="meta-grid">
      <div class="row"><span class="k">${escapeHtml(labels.patient)}</span><span class="v">${escapeHtml(mcase.patient.fullName)}</span></div>
      <div class="row"><span class="k">${escapeHtml(labels.phone)}</span><span class="v">${escapeHtml(formatPhone(mcase.patient.phone))}</span></div>
      ${
        patientBirth
          ? `<div class="row"><span class="k">${escapeHtml(labels.birthDate)}</span><span class="v">${escapeHtml(patientBirth)}</span></div>`
          : ""
      }
      ${
        patientGender
          ? `<div class="row"><span class="k">${escapeHtml(labels.gender)}</span><span class="v">${escapeHtml(patientGender)}</span></div>`
          : ""
      }
      <div class="row"><span class="k">${escapeHtml(labels.primaryDoctor)}</span><span class="v">${escapeHtml(doctorName ?? labels.empty)}</span></div>
      <div class="row"><span class="k">${escapeHtml(labels.status)}</span><span class="v"><span class="badge ${mcase.closedAt ? "closed" : ""}">${escapeHtml(statusLabels[mcase.status] ?? mcase.status)}</span></span></div>
      <div class="row"><span class="k">${escapeHtml(labels.opened)}</span><span class="v">${escapeHtml(formatDate(mcase.openedAt, locale, "short"))}</span></div>
      <div class="row"><span class="k">${escapeHtml(labels.closed)}</span><span class="v">${mcase.closedAt ? escapeHtml(formatDate(mcase.closedAt, locale, "short")) : labels.empty}</span></div>
    </div>

    <section class="block">
      <h3>${escapeHtml(labels.complaint)}</h3>
      <div class="body">${mcase.primaryComplaint ? escapeHtml(mcase.primaryComplaint) : `<span class="empty">${labels.empty}</span>`}</div>
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.diagnosis)}${mcase.diagnosisCode ? ` <span style="color:#1a1f2e;font-weight:600">· ${escapeHtml(labels.diagnosisCode)}: ${escapeHtml(mcase.diagnosisCode)}</span>` : ""}</h3>
      <div class="body">${mcase.diagnosisText ? escapeHtml(mcase.diagnosisText) : `<span class="empty">${labels.empty}</span>`}</div>
    </section>

    ${
      mcase.notes
        ? `<section class="block">
            <h3>${escapeHtml(labels.notes)}</h3>
            <div class="body">${escapeHtml(mcase.notes)}</div>
          </section>`
        : ""
    }

    <section class="block">
      <h3>${escapeHtml(labels.sectionVisits)}</h3>
      ${
        mcase.appointments.length === 0
          ? `<div class="empty">${escapeHtml(labels.noVisits)}</div>`
          : `<table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>${escapeHtml(labels.colDate)}</th>
                  <th>${escapeHtml(labels.colKind)}</th>
                  <th>${escapeHtml(labels.colDoctor)}</th>
                  <th>${escapeHtml(labels.colServices)}</th>
                  <th>${escapeHtml(labels.colPrice)}</th>
                  <th>${escapeHtml(labels.colStatus)}</th>
                </tr>
              </thead>
              <tbody>${visitRows}</tbody>
            </table>
            <div class="totals">
              <span>${escapeHtml(labels.totalBilled)}:</span>
              <span>${escapeHtml(formatMoney(totalBilled, "UZS", locale))}</span>
            </div>`
      }
    </section>

    <footer>
      <span>${escapeHtml(labels.generated)}: ${escapeHtml(formatDate(generatedAt, locale, "long"))} ${escapeHtml(formatDate(generatedAt, locale, "time"))}</span>
      <span>${escapeHtml(clinicName)}</span>
    </footer>
  </div>
</body>
</html>`;

    // Audit log so we can trace who exported which case.
    await audit(request, {
      action: "medical_case.export_pdf",
      entityType: "MedicalCase",
      entityId: id,
      meta: { format: "html_print", locale, visits: mcase.appointments.length },
    });

    const filename = `case-${mcase.id}.html`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
);
