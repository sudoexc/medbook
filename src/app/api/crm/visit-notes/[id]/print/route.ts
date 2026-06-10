/**
 * GET /api/crm/visit-notes/[id]/print — printable conclusion (RU/UZ).
 *
 * Same shape as /api/crm/cases/[id]/pdf — no PDF dependency by design.
 * Returns a self-contained print-styled HTML document; user does
 * Cmd/Ctrl+P → "Save as PDF" to land a real PDF.
 *
 * Ф5 — print v2:
 *   - `?lang` now defaults to the patient's `preferredLang` (explicit query
 *     still wins); a RU/UZ switcher sits in the print bar.
 *   - medication intake grid (deterministic model shared with the PDF worker
 *     via `render-handout.ts`) renders on every type that prints meds.
 *   - QR verification block when the conclusion Document carries a
 *     `verifyToken` (minted by the handout worker on finalize).
 *   - `?type=package` — conclusion + patient handout + issued e-prescriptions
 *     + referrals as ONE document with page breaks («распечатать всё»).
 *
 * Tenant guard: doctor must own the note, admin sees any note in the
 * active clinic (auto-scoped by the Prisma tenant extension).
 */
import QRCode from "qrcode";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { forbidden, notFound } from "@/server/http";
import { formatDate, formatPhone, type Locale } from "@/lib/format";
import { formatPrescriptionLines } from "@/lib/catalogs/prescription-format";
import {
  buildMedicationGrid,
  renderHandoutHtml,
  renderMedicationGridHtml,
} from "@/server/visit-notes/render-handout";

function idFromUrl(request: Request): string {
  // /api/crm/visit-notes/[id]/print — id is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

// Explicit ?lang wins; null lets the handler fall back to the patient's
// preferred language (Ф5).
function pickLocale(request: Request): Locale | null {
  const q = (new URL(request.url).searchParams.get("lang") ?? "").toLowerCase();
  if (q === "uz") return "uz";
  if (q === "ru") return "ru";
  return null;
}

function pickPrintType(request: Request): "clinical" | "handout" | "package" {
  const q = (new URL(request.url).searchParams.get("type") ?? "").toLowerCase();
  if (q === "handout") return "handout";
  if (q === "package") return "package";
  return "clinical";
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

function renderChips(items: string[]): string {
  if (!items || items.length === 0) {
    return `<div class="empty">—</div>`;
  }
  return `<ul class="chips">${items
    .map((it) => `<li>${escapeHtml(it)}</li>`)
    .join("")}</ul>`;
}

function renderBody(markdown: string | null): string {
  // Body is plain text with line breaks — render as <pre>-ish but allow wrap.
  if (!markdown || markdown.trim().length === 0) {
    return `<div class="empty">—</div>`;
  }
  return `<div class="body-md">${escapeHtml(markdown)}</div>`;
}

// Stored JSON shape of EPrescription.items (see schema comment).
type RxItem = {
  drugName?: string;
  dose?: string;
  frequency?: string;
  durationDays?: number;
  instructions?: string;
};

const QR_OPTS = {
  margin: 0,
  width: 140,
  errorCorrectionLevel: "M",
} as const;

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const explicitLocale = pickLocale(request);
    const printType = pickPrintType(request);

    const note = await prisma.visitNote.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            birthDate: true,
            gender: true,
            preferredLang: true,
          },
        },
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            specializationRu: true,
            specializationUz: true,
          },
        },
        appointment: { select: { id: true, date: true, time: true } },
        visitPrescriptions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!note) return notFound();

    // Ф5 — default print language follows the patient.
    const locale: Locale =
      explicitLocale ?? (note.patient.preferredLang === "UZ" ? "uz" : "ru");

    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || doctor.id !== note.doctorId) return forbidden();
    }

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
              letterheadUrl: true,
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
    const brandColor = clinic?.brandColor ?? "#3DD5C0";

    const doctorName = note.doctor
      ? locale === "uz"
        ? note.doctor.nameUz
        : note.doctor.nameRu
      : null;
    const doctorSpec = note.doctor
      ? locale === "uz"
        ? note.doctor.specializationUz
        : note.doctor.specializationRu
      : null;

    const labels =
      locale === "uz"
        ? {
            title: "Tashrif xulosasi",
            patient: "Bemor",
            phone: "Telefon",
            birthDate: "Tugʻilgan sana",
            gender: "Jinsi",
            doctor: "Shifokor",
            specialization: "Mutaxassislik",
            visitDate: "Tashrif sanasi",
            status: "Holat",
            statusDraft: "Qoralama",
            statusFinalized: "Yakunlangan",
            finalizedAt: "Yakunlangan vaqti",
            diagnosis: "Tashxis (ICD-10)",
            complaints: "Shikoyatlar",
            anamnesis: "Anamnez",
            examination: "Koʻrik",
            prescriptions: "Tayinlangan davo",
            advice: "Tavsiyalar",
            bodySection: "Xulosa matni",
            generated: "Hujjat yaratildi",
            print: "Chop etish / PDF",
            genderM: "Erkak",
            genderF: "Ayol",
            aiGenerated: "AI yordamida tayyorlangan",
            date: "Sana",
            signature: "Imzo",
            gridTitle: "Qabul jadvali",
            verify: "Haqiqiylikni QR orqali tekshiring",
            rxTitle: "Retsept",
            rxValidUntil: "Amal qilish muddati",
            referralTitle: "Yoʻllanma",
            referralTo: "Kimga",
            referralReason: "Yoʻllanma sababi",
            packageTitle: "Hujjatlar toʻplami",
            followUp: "Nazorat tashrifi",
          }
        : {
            title: "Заключение по приёму",
            patient: "Пациент",
            phone: "Телефон",
            birthDate: "Дата рождения",
            gender: "Пол",
            doctor: "Врач",
            specialization: "Специальность",
            visitDate: "Дата приёма",
            status: "Статус",
            statusDraft: "Черновик",
            statusFinalized: "Финализировано",
            finalizedAt: "Дата финализации",
            diagnosis: "Диагноз (МКБ-10)",
            complaints: "Жалобы",
            anamnesis: "Анамнез",
            examination: "Осмотр",
            prescriptions: "Назначения",
            advice: "Рекомендации",
            bodySection: "Текст заключения",
            generated: "Документ сформирован",
            print: "Печать / PDF",
            genderM: "Муж.",
            genderF: "Жен.",
            aiGenerated: "Сформировано с участием AI",
            date: "Дата",
            signature: "Подпись",
            gridTitle: "Схема приёма",
            verify: "Проверка подлинности — отсканируйте QR",
            rxTitle: "Рецепт",
            rxValidUntil: "Действителен до",
            referralTitle: "Направление",
            referralTo: "Кому",
            referralReason: "Причина направления",
            packageTitle: "Пакет документов",
            followUp: "Контрольный визит",
          };

    const patientGender =
      note.patient.gender === "MALE"
        ? labels.genderM
        : note.patient.gender === "FEMALE"
          ? labels.genderF
          : null;
    const patientBirth = note.patient.birthDate
      ? formatDate(note.patient.birthDate, locale, "short")
      : null;

    const visitDate = note.appointment
      ? `${formatDate(note.appointment.date, locale, "short")}${note.appointment.time ? ` · ${escapeHtml(note.appointment.time)}` : ""}`
      : note.startedAt
        ? formatDate(note.startedAt, locale, "short")
        : "—";

    const diagnosisLine = note.diagnosisCode
      ? `${escapeHtml(note.diagnosisCode)}${note.diagnosisName ? ` · ${escapeHtml(note.diagnosisName)}` : ""}`
      : `<span class="empty">—</span>`;

    const generatedAt = new Date();
    const isFinalized = note.status === "FINALIZED";

    // Ф0 — document number (allocated at finalize) + letterhead header.
    // The letterhead image, when configured, replaces the text header on
    // every printed artifact; the document title + № move below it.
    const numberHtml = note.documentNumber
      ? `<div class="doc-number">№ ${escapeHtml(note.documentNumber)}</div>`
      : "";
    const renderHeader = (titleInner: string): string =>
      clinic?.letterheadUrl
        ? `<header class="letterhead">
      <img src="${escapeHtml(clinic.letterheadUrl)}" alt="${escapeHtml(clinicName)}" />
      <div class="letterhead-row"><h2>${titleInner}</h2>${numberHtml}</div>
    </header>`
        : `<header class="header">
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
        <h2>${titleInner}</h2>
        ${numberHtml}
      </div>
    </header>`;
    const letterheadCss = `
    .letterhead {
      border-bottom: 2px solid var(--brand);
      padding-bottom: 10px;
      margin-bottom: 16px;
    }
    .letterhead img { width: 100%; display: block; }
    .letterhead-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-top: 10px;
    }
    .letterhead-row h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: var(--brand);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .doc-number {
      margin-top: 4px;
      font-size: 11px;
      font-weight: 700;
      color: #1a1f2e;
      white-space: nowrap;
    }`;

    // ── Ф6 — control-visit line (clinical + handout) ───────────────────
    // Due date anchors on finalizedAt when present (matches the bridge
    // worker), otherwise "now" as the draft-print estimate.
    const followUpLine =
      note.followUpDays != null && note.followUpDays > 0
        ? (() => {
            const due = new Date(
              (note.finalizedAt ?? generatedAt).getTime() +
                note.followUpDays * 86_400_000,
            );
            const dateStr = formatDate(due, locale, "short");
            return locale === "uz"
              ? `${note.followUpDays} kundan keyin · ≈ ${dateStr}`
              : `через ${note.followUpDays} дн. · ≈ ${dateStr}`;
          })()
        : null;

    // ── Ф5 fragments shared by all print types ────────────────────────
    const medGridTable =
      note.visitPrescriptions.length > 0
        ? renderMedicationGridHtml(
            buildMedicationGrid(note.visitPrescriptions, locale),
          )
        : "";

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
      new URL(request.url).origin;
    const conclusionDoc = await prisma.document.findUnique({
      where: { visitNoteId: id },
      select: { verifyToken: true },
    });
    const verifyBlockFor = (url: string | null, qr: string | null): string =>
      url && qr
        ? `<div class="verify"><img src="${qr}" alt="QR" /><div><div class="verify-title">${escapeHtml(labels.verify)}</div><div class="verify-url">${escapeHtml(url)}</div></div></div>`
        : "";
    const verifyUrl = conclusionDoc?.verifyToken
      ? `${baseUrl}/v/${conclusionDoc.verifyToken}`
      : null;
    const qrDataUrl = verifyUrl
      ? await QRCode.toDataURL(verifyUrl, QR_OPTS)
      : null;
    const verifyBlock = verifyBlockFor(verifyUrl, qrDataUrl);

    const langSwitchHtml = `<div class="lang-switch">
      <a href="?lang=ru&type=${printType}" class="${locale === "ru" ? "on" : ""}">RU</a>
      <a href="?lang=uz&type=${printType}" class="${locale === "uz" ? "on" : ""}">UZ</a>
    </div>`;

    const f5Css = `
    .lang-switch { display: flex; gap: 4px; margin-right: auto; }
    .lang-switch a {
      padding: 7px 12px;
      border-radius: 6px;
      border: 1px solid #e5e7eb;
      background: #fff;
      color: #525866;
      text-decoration: none;
      font-weight: 600;
      font-size: 12px;
    }
    .lang-switch a.on { background: var(--brand); border-color: var(--brand); color: #fff; }
    .med-grid {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 11px;
    }
    .med-grid th, .med-grid td {
      border: 1px solid #e3e6ec;
      padding: 5px 8px;
      text-align: left;
      vertical-align: top;
    }
    .med-grid th {
      background: #f4f6fa;
      color: #525866;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .med-grid th.med-slot, .med-grid td.med-slot { text-align: center; width: 9%; }
    .med-grid .med-note { color: #8b909b; font-size: 10px; margin-top: 2px; font-weight: 400; }
    .verify { margin-top: 16px; display: flex; gap: 10px; align-items: center; }
    .verify img { width: 64px; height: 64px; }
    .verify-title { font-weight: 600; font-size: 10px; color: #525866; }
    .verify-url { font-size: 9px; color: #8b909b; word-break: break-all; }`;

    // Shared by the standalone handout page and the package assembly.
    const quickMetaMdCss = `
    .quick-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
      margin-bottom: 18px;
      color: #525866;
      font-size: 12px;
    }
    .quick-meta strong {
      color: #1a1f2e;
      margin-left: 4px;
    }
    .md-h1 {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 12px 0;
      color: #1a1f2e;
    }
    .md-h2 {
      font-size: 14px;
      font-weight: 700;
      margin: 14px 0 6px 0;
      color: #1a1f2e;
    }
    .md-list {
      list-style: none;
      padding: 0;
      margin: 4px 0 6px 0;
    }
    .md-list li {
      position: relative;
      padding-left: 18px;
      margin: 4px 0;
    }
    .md-list li::before {
      content: "";
      position: absolute;
      left: 6px;
      top: 9px;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--brand);
    }`;

    // ── Patient-facing handout fragment (standalone page + package) ───
    const handoutLabels =
      locale === "uz"
        ? {
            title: "Bemor uchun eslatma",
            patient: "Bemor",
            doctor: "Shifokor",
            visitDate: "Tashrif sanasi",
            print: "Chop etish / PDF",
            generated: "Tayyorlandi",
            emptyHint:
              "Eslatma hali shakllantirilmagan. Iltimos, qabul oynasida \"Shakllantirish\" tugmasini bosing.",
          }
        : {
            title: "Памятка для пациента",
            patient: "Пациент",
            doctor: "Врач",
            visitDate: "Дата приёма",
            print: "Печать / PDF",
            generated: "Подготовлено",
            emptyHint:
              "Памятка ещё не сформирована. На экране приёма нажмите «Сформировать», затем повторите печать.",
          };

    const handoutBody = note.patientHandoutMarkdown?.trim()
      ? renderHandoutHtml(note.patientHandoutMarkdown)
      : `<p class="empty">${escapeHtml(handoutLabels.emptyHint)}</p>`;

    const handoutGridSection = medGridTable
      ? `<section><h2 class="md-h2">${escapeHtml(labels.gridTitle)}</h2>${medGridTable}</section>`
      : "";

    // Patient-facing: date only, the reception note stays internal.
    const handoutFollowUpSection = followUpLine
      ? `<section><h2 class="md-h2">${escapeHtml(labels.followUp)}</h2><p><strong>${escapeHtml(followUpLine)}</strong></p></section>`
      : "";

    const handoutInner = `${renderHeader(escapeHtml(handoutLabels.title))}

    <div class="quick-meta">
      <span>${escapeHtml(handoutLabels.patient)}<strong>${escapeHtml(note.patient.fullName)}</strong></span>
      <span>${escapeHtml(handoutLabels.doctor)}<strong>${escapeHtml(doctorName ?? "—")}</strong></span>
      <span>${escapeHtml(handoutLabels.visitDate)}<strong>${visitDate}</strong></span>
    </div>

    <article>${handoutBody}</article>

    ${handoutGridSection}

    ${handoutFollowUpSection}

    <div class="signature">
      <div class="slot">${escapeHtml(handoutLabels.doctor)}: ${escapeHtml(doctorName ?? "")}</div>
      <div class="slot">${escapeHtml(handoutLabels.patient)}: ${escapeHtml(note.patient.fullName)}</div>
    </div>

    ${verifyBlock}

    <footer>
      <span>${escapeHtml(handoutLabels.generated)}: ${escapeHtml(formatDate(generatedAt, locale, "long"))} ${escapeHtml(formatDate(generatedAt, locale, "time"))}</span>
      <span>${escapeHtml(clinicName)}</span>
    </footer>`;

    if (printType === "handout") {
      const handoutHtml = `<!doctype html>
<html lang="${locale === "uz" ? "uz" : "ru"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`${handoutLabels.title} — ${note.patient.fullName}`)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root { --brand: ${escapeHtml(brandColor)}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
      color: #1a1f2e;
      font-size: 13px;
      line-height: 1.6;
      background: #fff;
    }
    .page {
      max-width: 760px;
      margin: 24px auto;
      padding: 24px 32px;
    }
    @media print {
      body { font-size: 12px; }
      .page { margin: 0; padding: 16mm; max-width: none; }
      .no-print { display: none !important; }
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
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .header .logo {
      width: 56px; height: 56px;
      border-radius: 8px;
      background: #f1f5f9;
      object-fit: contain;
      display: block;
    }
    .header .clinic-name {
      font-size: 17px;
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
      font-size: 13px;
      font-weight: 700;
      color: var(--brand);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    p {
      margin: 6px 0;
    }
    em {
      color: #525866;
      font-style: italic;
    }
    strong {
      color: #1a1f2e;
    }
    .empty {
      color: #8b909b;
      font-style: italic;
    }
    .signature {
      margin-top: 36px;
      padding-top: 16px;
      border-top: 1px dotted #d6dae2;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      font-size: 11px;
      color: #525866;
    }
    .signature .slot {
      border-top: 1px solid #1a1f2e;
      padding-top: 6px;
    }
    footer {
      margin-top: 18px;
      color: #8b909b;
      font-size: 10px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    ${quickMetaMdCss}
    ${letterheadCss}
    ${f5Css}
    @page {
      size: A4 portrait;
      margin: 16mm;
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    ${langSwitchHtml}
    <button onclick="window.print()">${escapeHtml(handoutLabels.print)}</button>
  </div>
  <div class="page">
    ${handoutInner}
  </div>
</body>
</html>`;

      await audit(request, {
        action: "visit_note.print",
        entityType: "VisitNote",
        entityId: id,
        meta: { locale, status: note.status, type: "handout" },
      });

      return new Response(handoutHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="patient-handout-${note.id}.html"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    // ── Clinical conclusion fragment (standalone page + package) ──────
    const clinicalGridSection = medGridTable
      ? `<section class="block">
      <h3>${escapeHtml(labels.gridTitle)}</h3>
      ${medGridTable}
    </section>`
      : "";

    const clinicalInner = `${renderHeader(`${escapeHtml(labels.title)}${note.aiGenerated ? `<span class="ai-tag">${escapeHtml(labels.aiGenerated)}</span>` : ""}`)}

    <div class="meta-grid">
      <div class="row"><span class="k">${escapeHtml(labels.patient)}</span><span class="v">${escapeHtml(note.patient.fullName)}</span></div>
      <div class="row"><span class="k">${escapeHtml(labels.phone)}</span><span class="v">${escapeHtml(formatPhone(note.patient.phone))}</span></div>
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
      <div class="row"><span class="k">${escapeHtml(labels.doctor)}</span><span class="v">${escapeHtml(doctorName ?? "—")}</span></div>
      ${
        doctorSpec
          ? `<div class="row"><span class="k">${escapeHtml(labels.specialization)}</span><span class="v">${escapeHtml(doctorSpec)}</span></div>`
          : ""
      }
      <div class="row"><span class="k">${escapeHtml(labels.visitDate)}</span><span class="v">${visitDate}</span></div>
      <div class="row"><span class="k">${escapeHtml(labels.status)}</span><span class="v"><span class="badge ${isFinalized ? "" : "draft"}">${escapeHtml(isFinalized ? labels.statusFinalized : labels.statusDraft)}</span></span></div>
      ${
        isFinalized && note.finalizedAt
          ? `<div class="row"><span class="k">${escapeHtml(labels.finalizedAt)}</span><span class="v">${escapeHtml(formatDate(note.finalizedAt, locale, "short"))} ${escapeHtml(formatDate(note.finalizedAt, locale, "time"))}</span></div>`
          : ""
      }
    </div>

    <section class="block">
      <h3>${escapeHtml(labels.diagnosis)}</h3>
      <div>${diagnosisLine}</div>
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.complaints)}</h3>
      ${renderChips(note.complaints)}
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.anamnesis)}</h3>
      ${renderChips(note.anamnesis)}
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.examination)}</h3>
      ${renderChips(note.examination)}
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.prescriptions)}</h3>
      ${renderChips([
        ...formatPrescriptionLines(note.visitPrescriptions, locale, {
          withInstruction: true,
        }),
        ...note.prescriptions,
      ])}
    </section>

    ${clinicalGridSection}

    <section class="block">
      <h3>${escapeHtml(labels.advice)}</h3>
      ${renderChips(note.advice)}
    </section>

    ${
      followUpLine
        ? `<section class="block">
      <h3>${escapeHtml(labels.followUp)}</h3>
      <div><strong>${escapeHtml(followUpLine)}</strong>${note.followUpNote?.trim() ? ` — ${escapeHtml(note.followUpNote.trim())}` : ""}</div>
    </section>`
        : ""
    }

    <section class="block">
      <h3>${escapeHtml(labels.bodySection)}</h3>
      ${renderBody(note.bodyMarkdown)}
    </section>

    <div class="signature">
      <div class="slot">${escapeHtml(labels.doctor)}: ${escapeHtml(doctorName ?? "")}${doctorSpec ? `, ${escapeHtml(doctorSpec)}` : ""}</div>
      <div class="slot">${escapeHtml(labels.date)}: ${escapeHtml(formatDate(note.finalizedAt ?? generatedAt, locale, "short"))} · ${escapeHtml(labels.signature)}: ____________</div>
    </div>

    ${verifyBlock}

    <footer>
      <span>${escapeHtml(labels.generated)}: ${escapeHtml(formatDate(generatedAt, locale, "long"))} ${escapeHtml(formatDate(generatedAt, locale, "time"))}</span>
      <span>${escapeHtml(clinicName)}</span>
    </footer>`;

    const wrapDoc = (
      docTitle: string,
      inner: string,
      extraCss = "",
    ): string => `<!doctype html>
<html lang="${locale === "uz" ? "uz" : "ru"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(docTitle)}</title>
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
      line-height: 1.5;
      background: #fff;
    }
    .page {
      max-width: 800px;
      margin: 24px auto;
      padding: 24px 32px;
    }
    .page-break {
      border-top: 2px dashed #e5e7eb;
      margin: 28px 0;
    }
    @media print {
      body { font-size: 11px; }
      .page { margin: 0; padding: 16mm; max-width: none; }
      .no-print { display: none !important; }
      .page-break { border: 0; margin: 0; page-break-before: always; }
      section.block { page-break-inside: avoid; }
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
    .badge.draft { background: #fef3c7; color: #92400e; }
    .ai-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #ede9fe;
      color: #6d28d9;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
    }
    section.block {
      margin: 14px 0;
    }
    section.block h3 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #525866;
      font-weight: 700;
    }
    .empty {
      color: #8b909b;
      font-style: italic;
    }
    .chips {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chips li {
      background: #f4f6fa;
      border: 1px solid #e3e6ec;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
    }
    .body-md {
      white-space: pre-wrap;
      background: #fafbfd;
      border: 1px solid #e7e9ee;
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 12px;
      line-height: 1.55;
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
    .signature {
      margin-top: 24px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
    }
    .signature .slot {
      border-top: 1px solid #1a1f2e;
      padding-top: 6px;
      font-size: 11px;
      color: #525866;
    }
    ${letterheadCss}
    ${f5Css}
    ${extraCss}
    @page {
      size: A4 portrait;
      margin: 14mm;
    }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    ${langSwitchHtml}
    <button onclick="window.print()">${escapeHtml(labels.print)}</button>
  </div>
  <div class="page">
    ${inner}
  </div>
</body>
</html>`;

    // ── Ф5 — package print: everything in one document ────────────────
    if (printType === "package") {
      const [rxs, refs] = await Promise.all([
        prisma.ePrescription.findMany({
          where: { visitNoteId: id, status: "ISSUED" },
          orderBy: { issuedAt: "asc" },
          select: {
            id: true,
            rxNumber: true,
            items: true,
            issuedAt: true,
            validUntilAt: true,
            verifyToken: true,
            doctor: { select: { name: true } },
          },
        }),
        prisma.referral.findMany({
          where: { visitNoteId: id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            externalTo: true,
            reason: true,
            diagnosisCode: true,
            diagnosisName: true,
            createdAt: true,
            toDoctor: { select: { name: true } },
            fromDoctor: { select: { name: true } },
            document: { select: { verifyToken: true } },
          },
        }),
      ]);

      const rxFragments = await Promise.all(
        rxs.map(async (rx) => {
          const items = Array.isArray(rx.items) ? (rx.items as RxItem[]) : [];
          const lines = items.map((it) => {
            const head = it.drugName?.trim() || "—";
            const duration =
              it.durationDays != null
                ? locale === "uz"
                  ? `${it.durationDays} kun`
                  : `${it.durationDays} дн.`
                : null;
            const parts = [it.dose?.trim(), it.frequency?.trim(), duration]
              .filter((x): x is string => Boolean(x));
            let line = parts.length ? `${head} — ${parts.join(", ")}` : head;
            if (it.instructions?.trim()) line += `. ${it.instructions.trim()}`;
            return line;
          });
          const rxVerifyUrl = `${baseUrl}/api/verify/recipe/${rx.verifyToken}`;
          const rxQr = await QRCode.toDataURL(rxVerifyUrl, QR_OPTS);
          return `<div class="page-break"></div>
    ${renderHeader(`${escapeHtml(labels.rxTitle)} · ${escapeHtml(rx.rxNumber)}`)}

    <div class="quick-meta">
      <span>${escapeHtml(labels.patient)}<strong>${escapeHtml(note.patient.fullName)}</strong></span>
      <span>${escapeHtml(labels.doctor)}<strong>${escapeHtml(rx.doctor.name)}</strong></span>
      <span>${escapeHtml(labels.date)}<strong>${escapeHtml(formatDate(rx.issuedAt, locale, "short"))}</strong></span>
      <span>${escapeHtml(labels.rxValidUntil)}<strong>${escapeHtml(formatDate(rx.validUntilAt, locale, "short"))}</strong></span>
    </div>

    <section class="block">
      <h3>${escapeHtml(labels.prescriptions)}</h3>
      ${
        lines.length > 0
          ? `<ul class="md-list">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
          : `<div class="empty">—</div>`
      }
    </section>

    <div class="signature">
      <div class="slot">${escapeHtml(labels.doctor)}: ${escapeHtml(rx.doctor.name)}</div>
      <div class="slot">${escapeHtml(labels.date)}: ${escapeHtml(formatDate(rx.issuedAt, locale, "short"))} · ${escapeHtml(labels.signature)}: ____________</div>
    </div>

    ${verifyBlockFor(rxVerifyUrl, rxQr)}`;
        }),
      );

      const refFragments = await Promise.all(
        refs.map(async (ref) => {
          const to = ref.toDoctor?.name ?? ref.externalTo ?? "—";
          const diag = [ref.diagnosisCode, ref.diagnosisName]
            .filter((x): x is string => Boolean(x && x.trim()))
            .join(" · ");
          const token = ref.document?.verifyToken ?? null;
          const refVerifyUrl = token ? `${baseUrl}/v/${token}` : null;
          const refQr = refVerifyUrl
            ? await QRCode.toDataURL(refVerifyUrl, QR_OPTS)
            : null;
          return `<div class="page-break"></div>
    ${renderHeader(escapeHtml(labels.referralTitle))}

    <div class="quick-meta">
      <span>${escapeHtml(labels.patient)}<strong>${escapeHtml(note.patient.fullName)}</strong></span>
      <span>${escapeHtml(labels.doctor)}<strong>${escapeHtml(ref.fromDoctor.name)}</strong></span>
      <span>${escapeHtml(labels.date)}<strong>${escapeHtml(formatDate(ref.createdAt, locale, "short"))}</strong></span>
    </div>

    <section class="block">
      <h3>${escapeHtml(labels.referralTo)}</h3>
      <div>${escapeHtml(to)}</div>
    </section>

    ${
      diag
        ? `<section class="block">
      <h3>${escapeHtml(labels.diagnosis)}</h3>
      <div>${escapeHtml(diag)}</div>
    </section>`
        : ""
    }

    <section class="block">
      <h3>${escapeHtml(labels.referralReason)}</h3>
      ${renderBody(ref.reason)}
    </section>

    <div class="signature">
      <div class="slot">${escapeHtml(labels.doctor)}: ${escapeHtml(ref.fromDoctor.name)}</div>
      <div class="slot">${escapeHtml(labels.date)}: ${escapeHtml(formatDate(ref.createdAt, locale, "short"))} · ${escapeHtml(labels.signature)}: ____________</div>
    </div>

    ${verifyBlockFor(refVerifyUrl, refQr)}`;
        }),
      );

      const packageInner = [
        clinicalInner,
        `<div class="page-break"></div>`,
        handoutInner,
        ...rxFragments,
        ...refFragments,
      ].join("\n");

      await audit(request, {
        action: "visit_note.print",
        entityType: "VisitNote",
        entityId: id,
        meta: {
          locale,
          status: note.status,
          type: "package",
          rxCount: rxs.length,
          referralCount: refs.length,
        },
      });

      return new Response(
        wrapDoc(
          `${labels.packageTitle} — ${note.patient.fullName}`,
          packageInner,
          quickMetaMdCss,
        ),
        {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `inline; filename="visit-package-${note.id}.html"`,
            "Cache-Control": "private, no-store",
          },
        },
      );
    }

    await audit(request, {
      action: "visit_note.print",
      entityType: "VisitNote",
      entityId: id,
      meta: { locale, status: note.status, type: "clinical" },
    });

    return new Response(
      wrapDoc(`${labels.title} — ${note.patient.fullName}`, clinicalInner),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="visit-note-${note.id}.html"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  },
);
