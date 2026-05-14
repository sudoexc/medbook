/**
 * GET /api/crm/visit-notes/[id]/print — printable conclusion (RU/UZ).
 *
 * Same shape as /api/crm/cases/[id]/pdf — no PDF dependency by design.
 * Returns a self-contained print-styled HTML document; user does
 * Cmd/Ctrl+P → "Save as PDF" to land a real PDF.
 *
 * Tenant guard: doctor must own the note, admin sees any note in the
 * active clinic (auto-scoped by the Prisma tenant extension).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { forbidden, notFound } from "@/server/http";
import { formatDate, formatPhone, type Locale } from "@/lib/format";

function idFromUrl(request: Request): string {
  // /api/crm/visit-notes/[id]/print — id is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

function pickLocale(request: Request): Locale {
  const q = (new URL(request.url).searchParams.get("lang") ?? "").toLowerCase();
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

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const locale = pickLocale(request);

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
      },
    });
    if (!note) return notFound();

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

    const html = `<!doctype html>
<html lang="${locale === "uz" ? "uz" : "ru"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`${labels.title} — ${note.patient.fullName}`)}</title>
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
    @media print {
      body { font-size: 11px; }
      .page { margin: 0; padding: 16mm; max-width: none; }
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
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
        <h2>${escapeHtml(labels.title)}${note.aiGenerated ? `<span class="ai-tag">${escapeHtml(labels.aiGenerated)}</span>` : ""}</h2>
      </div>
    </header>

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
      ${renderChips(note.prescriptions)}
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.advice)}</h3>
      ${renderChips(note.advice)}
    </section>

    <section class="block">
      <h3>${escapeHtml(labels.bodySection)}</h3>
      ${renderBody(note.bodyMarkdown)}
    </section>

    <div class="signature">
      <div class="slot">${escapeHtml(labels.doctor)}: ${escapeHtml(doctorName ?? "")}</div>
      <div class="slot">${escapeHtml(labels.patient)}: ${escapeHtml(note.patient.fullName)}</div>
    </div>

    <footer>
      <span>${escapeHtml(labels.generated)}: ${escapeHtml(formatDate(generatedAt, locale, "long"))} ${escapeHtml(formatDate(generatedAt, locale, "time"))}</span>
      <span>${escapeHtml(clinicName)}</span>
    </footer>
  </div>
</body>
</html>`;

    await audit(request, {
      action: "visit_note.print",
      entityType: "VisitNote",
      entityId: id,
      meta: { locale, status: note.status },
    });

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="visit-note-${note.id}.html"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
);
