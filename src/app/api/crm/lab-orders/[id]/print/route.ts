/**
 * GET /api/crm/lab-orders/[id]/print — printable направление as standalone HTML.
 *
 * Returns a single page (print CSS: @page A4, no margins) that the browser
 * opens in a new tab; window.print() fires on load. The QR code embeds an
 * `LO:<orderNumber>` payload so the lab station can scan to open the result
 * entry form once that UI lands (G3 still relies on doctors typing values
 * into /doctors/me/labs).
 *
 * Stamps `printedAt` on first GET so admins know what's been handed to the
 * patient. We do NOT mutate status here — the printout being generated
 * doesn't mean the patient picked it up.
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

  const order = await prisma.labOrder.findFirst({
    where: { id, clinicId: ctx.clinicId },
    include: {
      patient: {
        select: {
          id: true,
          fullName: true,
          birthDate: true,
          gender: true,
          phoneNormalized: true,
        },
      },
      doctor: { select: { id: true, name: true, phone: true } },
      clinic: {
        select: {
          id: true,
          nameRu: true,
          phone: true,
          addressRu: true,
          logoUrl: true,
        },
      },
    },
  });
  if (!order) return new Response("Not found", { status: 404 });
  if (ctx.role === "DOCTOR" && order.doctorId !== ctx.userId) {
    return new Response("Forbidden", { status: 403 });
  }

  const [tests, panels] = await Promise.all([
    prisma.labTest.findMany({
      where: { code: { in: order.testCodes } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.labPanel.findMany({
      where: { code: { in: order.panelCodes } },
      orderBy: { sortOrder: "asc" },
      include: {
        tests: {
          orderBy: { sortOrder: "asc" },
          include: { test: { select: { code: true, nameRu: true, biomaterial: true } } },
        },
      },
    }),
  ]);

  if (!order.printedAt) {
    await prisma.labOrder.update({
      where: { id: order.id },
      data: { printedAt: new Date() },
    });
    await audit(request, {
      action: AUDIT_ACTION.LAB_ORDER_PRINTED,
      entityType: "LabOrder",
      entityId: order.id,
      meta: { printedAt: new Date().toISOString() },
    });
  }

  const qrPayload = `LO:${order.orderNumber}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 0,
    width: 140,
    errorCorrectionLevel: "M",
  });

  const html = renderHtml({
    order,
    tests,
    panels,
    qrDataUrl,
  });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  },
);

function idFromUrl(url: string): string | null {
  const m = /\/lab-orders\/([^/]+)\/print/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

type Order = {
  orderNumber: string;
  urgency: "ROUTINE" | "URGENT" | "STAT";
  diagnosisCode: string | null;
  notes: string | null;
  createdAt: Date;
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
};

type LabTestRow = {
  code: string;
  nameRu: string;
  biomaterial: string;
  unit: string | null;
  turnaroundHours: number;
  patientPrep: string | null;
};

type LabPanelRow = {
  code: string;
  nameRu: string;
  tests?: { test: { code: string; nameRu: string; biomaterial: string } }[];
};

function renderHtml({
  order,
  tests,
  panels,
  qrDataUrl,
}: {
  order: Order;
  tests: LabTestRow[];
  panels: LabPanelRow[];
  qrDataUrl: string;
}): string {
  const dateStr = order.createdAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const dob = order.patient.birthDate
    ? order.patient.birthDate.toLocaleDateString("ru-RU")
    : "—";
  const age = order.patient.birthDate
    ? `${calcAge(order.patient.birthDate)} лет`
    : "—";

  const flatPanelTests = panels.flatMap((p) =>
    (p.tests ?? []).map((t) => ({
      panelCode: p.code,
      panelName: p.nameRu,
      code: t.test.code,
      nameRu: t.test.nameRu,
      biomaterial: t.test.biomaterial,
    })),
  );

  const urgencyLabel =
    order.urgency === "STAT"
      ? "🔥 CITO"
      : order.urgency === "URGENT"
        ? "⚡ Срочно"
        : "Плановый";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`Направление ${order.orderNumber}`)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 11pt; }
  body { padding: 18px; }
  h1 { font-size: 14pt; margin: 0; }
  h2 { font-size: 11pt; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 5px 8px; vertical-align: top; }
  thead th { font-size: 9pt; color: #666; border-bottom: 1px solid #ccc; font-weight: 600; }
  tbody tr { border-bottom: 1px dotted #eee; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
  .header-left h1 { font-size: 16pt; font-weight: 700; }
  .header-left .sub { font-size: 9pt; color: #555; margin-top: 2px; }
  .header-right { text-align: right; }
  .qr { display: inline-block; }
  .qr img { display: block; }
  .order-number { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 10pt; margin-top: 4px; color: #222; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 12px; font-size: 10pt; }
  .grid .lbl { color: #777; font-size: 9pt; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9pt; font-weight: 600; }
  .badge-urgent { background: #fee; color: #b00; }
  .badge-stat { background: #b00; color: white; }
  .badge-routine { background: #eef; color: #335; }
  .signature { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; font-size: 10pt; }
  .signature .line { border-bottom: 1px solid #888; padding-top: 28px; }
  .prep { background: #fffbea; border: 1px solid #f5d97a; padding: 8px 10px; border-radius: 4px; margin-top: 10px; font-size: 9.5pt; }
  .prep b { color: #7a5500; }
  .footer { margin-top: 30px; font-size: 8.5pt; color: #888; text-align: center; }
  .panel-row { background: #f4f6fb; font-weight: 600; }
  @media print {
    body { padding: 0; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>${escapeHtml(order.clinic.nameRu)}</h1>
      <div class="sub">
        ${order.clinic.addressRu ? escapeHtml(order.clinic.addressRu) : ""}
        ${order.clinic.phone ? " · тел. " + escapeHtml(order.clinic.phone) : ""}
      </div>
      <h2 style="margin-top: 14px; border-bottom: none; padding-bottom: 0;">Направление на лабораторное исследование</h2>
    </div>
    <div class="header-right">
      <div class="qr"><img src="${qrDataUrl}" width="120" height="120" alt="QR ${escapeHtml(order.orderNumber)}"></div>
      <div class="order-number">№ ${escapeHtml(order.orderNumber)}</div>
      <div class="order-number">${escapeHtml(dateStr)}</div>
      <div style="margin-top: 6px;">
        <span class="badge ${order.urgency === "STAT" ? "badge-stat" : order.urgency === "URGENT" ? "badge-urgent" : "badge-routine"}">${escapeHtml(urgencyLabel)}</span>
      </div>
    </div>
  </div>

  <div class="grid">
    <div><span class="lbl">Пациент:</span> <b>${escapeHtml(order.patient.fullName)}</b></div>
    <div><span class="lbl">Дата рождения:</span> ${escapeHtml(dob)} (${escapeHtml(age)})</div>
    <div><span class="lbl">Пол:</span> ${order.patient.gender === "M" ? "мужской" : order.patient.gender === "F" ? "женский" : "—"}</div>
    <div><span class="lbl">Телефон:</span> ${escapeHtml(order.patient.phoneNormalized)}</div>
    <div><span class="lbl">Врач:</span> ${escapeHtml(order.doctor.name)}</div>
    <div><span class="lbl">МКБ-10:</span> ${order.diagnosisCode ? escapeHtml(order.diagnosisCode) : "—"}</div>
  </div>

  ${panels.length > 0 ? `<h2>Назначенные панели</h2>
  <table>
    <thead><tr><th style="width: 70px;">Код</th><th>Название</th><th style="width: 200px;">Тесты</th></tr></thead>
    <tbody>
      ${panels
        .map(
          (p) => `<tr>
            <td><code>${escapeHtml(p.code)}</code></td>
            <td><b>${escapeHtml(p.nameRu)}</b></td>
            <td>${(p.tests ?? []).map((t) => escapeHtml(t.test.code)).join(", ")}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>` : ""}

  <h2>Перечень исследований</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 36px;">№</th>
        <th style="width: 90px;">Код</th>
        <th>Наименование</th>
        <th style="width: 110px;">Биоматериал</th>
        <th style="width: 90px;">Срок</th>
      </tr>
    </thead>
    <tbody>
      ${
        renderLineItems(tests, flatPanelTests)
      }
    </tbody>
  </table>

  ${
    renderPrepBlock(tests)
  }

  ${
    order.notes
      ? `<h2>Примечания врача</h2><div style="white-space: pre-wrap; font-size: 10pt;">${escapeHtml(order.notes)}</div>`
      : ""
  }

  <div class="signature">
    <div>
      <div class="line"></div>
      <div style="text-align: center; color: #555; margin-top: 4px;">Подпись врача</div>
      <div style="text-align: center; font-size: 9pt; color: #888;">${escapeHtml(order.doctor.name)}</div>
    </div>
    <div>
      <div class="line"></div>
      <div style="text-align: center; color: #555; margin-top: 4px;">Печать клиники</div>
    </div>
  </div>

  <div class="footer">
    Сгенерировано MedBook · ${escapeHtml(order.orderNumber)} · ${escapeHtml(dateStr)}
  </div>

  <script>
    // Trigger print dialog on load. The doctor can press Esc to dismiss
    // and use the page as a preview before printing.
    setTimeout(function() { window.print(); }, 250);
  </script>
</body>
</html>`;
}

function renderLineItems(
  tests: LabTestRow[],
  flatPanelTests: { code: string; nameRu: string; biomaterial: string; panelCode: string }[],
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let n = 1;
  for (const t of tests) {
    if (seen.has(t.code)) continue;
    seen.add(t.code);
    out.push(rowHtml(n++, t.code, t.nameRu, t.biomaterial, `≈ ${t.turnaroundHours}ч`));
  }
  // Group panel tests by panel
  const byPanel = new Map<string, typeof flatPanelTests>();
  for (const t of flatPanelTests) {
    if (seen.has(t.code)) continue;
    if (!byPanel.has(t.panelCode)) byPanel.set(t.panelCode, []);
    byPanel.get(t.panelCode)!.push(t);
  }
  for (const [, items] of byPanel) {
    for (const t of items) {
      if (seen.has(t.code)) continue;
      seen.add(t.code);
      out.push(rowHtml(n++, t.code, t.nameRu, t.biomaterial, ""));
    }
  }
  if (out.length === 0) return `<tr><td colspan="5" style="text-align:center;color:#888;padding:18px;">Нет назначенных исследований</td></tr>`;
  return out.join("");
}

function rowHtml(n: number, code: string, name: string, biomaterial: string, turnaround: string): string {
  return `<tr>
    <td>${n}</td>
    <td><code>${escapeHtml(code)}</code></td>
    <td>${escapeHtml(name)}</td>
    <td>${escapeHtml(biomaterialLabel(biomaterial))}</td>
    <td>${escapeHtml(turnaround)}</td>
  </tr>`;
}

function renderPrepBlock(tests: LabTestRow[]): string {
  const prep = tests.filter((t) => t.patientPrep && t.patientPrep.trim());
  if (prep.length === 0) return "";
  return `<div class="prep">
    <b>Подготовка к исследованиям:</b>
    <ul style="margin: 4px 0 0 18px; padding: 0;">
      ${prep.map((t) => `<li><b>${escapeHtml(t.nameRu)}</b> — ${escapeHtml(t.patientPrep ?? "")}</li>`).join("")}
    </ul>
  </div>`;
}

function biomaterialLabel(b: string): string {
  switch (b) {
    case "BLOOD": return "кровь";
    case "SERUM": return "сыворотка";
    case "PLASMA": return "плазма";
    case "URINE": return "моча";
    case "STOOL": return "кал";
    case "SALIVA": return "слюна";
    case "SWAB": return "мазок";
    case "TISSUE": return "ткань";
    case "CSF": return "СМЖ";
    case "SPUTUM": return "мокрота";
    default: return "—";
  }
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
