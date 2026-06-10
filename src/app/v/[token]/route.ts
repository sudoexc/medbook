/**
 * GET /v/[token] — Ф5, public document authenticity check.
 *
 * Anonymous endpoint behind the QR printed on conclusions / handouts.
 * Mirrors /api/verify/recipe: short mobile HTML (or JSON via Accept)
 * confirming the paper is real — type, №, date, clinic, doctor, patient
 * masked to initials. The document CONTENT is intentionally never shown:
 * whoever scans holds the paper; the page only vouches for it.
 */
import { prisma } from "@/lib/prisma";

const TYPE_LABELS: Record<string, string> = {
  CONCLUSION: "Заключение врача",
  REFERRAL: "Направление",
  PRESCRIPTION: "Назначение",
  RESULT: "Результат исследования",
  CONSENT: "Согласие",
  CONTRACT: "Договор",
  RECEIPT: "Квитанция",
  OTHER: "Документ",
};

export async function GET(request: Request) {
  const m = /\/v\/([^/?]+)/.exec(request.url);
  if (!m) return new Response("Bad request", { status: 400 });
  const token = decodeURIComponent(m[1]);
  const wantsJson = (request.headers.get("accept") ?? "").includes(
    "application/json",
  );

  const doc = await prisma.document.findFirst({
    where: { verifyToken: token },
    include: {
      clinic: { select: { nameRu: true, phone: true } },
      patient: { select: { fullName: true } },
      visitNote: {
        select: {
          finalizedAt: true,
          doctor: { select: { nameRu: true } },
        },
      },
      referral: { select: { fromDoctor: { select: { name: true } } } },
    },
  });

  if (!doc) {
    return wantsJson
      ? Response.json({ ok: false, reason: "not_found" }, { status: 404 })
      : html(notFoundHtml(), 404);
  }

  const doctor =
    doc.visitNote?.doctor?.nameRu ?? doc.referral?.fromDoctor?.name ?? null;
  const issuedAt = doc.visitNote?.finalizedAt ?? doc.createdAt;
  const payload = {
    ok: true,
    type: doc.type,
    typeLabel: TYPE_LABELS[doc.type] ?? TYPE_LABELS.OTHER,
    number: doc.number,
    clinic: doc.clinic.nameRu,
    clinicPhone: doc.clinic.phone,
    doctor,
    patientMasked: maskName(doc.patient.fullName),
    issuedAt: issuedAt.toISOString(),
  };

  if (wantsJson) return Response.json(payload);
  return html(verifyHtml(payload));
}

function maskName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0][0] + ".";
  return parts.map((p, i) => (i === 0 ? p : p[0] + ".")).join(" ");
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function verifyHtml(p: {
  typeLabel: string;
  number: string | null;
  clinic: string;
  clinicPhone: string | null;
  doctor: string | null;
  patientMasked: string;
  issuedAt: string;
}): string {
  const issuedDt = new Date(p.issuedAt);
  const dateFmt: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "long",
    year: "numeric",
  };

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Проверка документа${p.number ? " " + esc(p.number) : ""}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f6f7f9; color: #111; }
  .card { max-width: 480px; margin: 12px auto; background: white; border-radius: 12px; padding: 22px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
  h1 { margin: 0 0 4px; font-size: 18pt; }
  .sub { color: #888; font-size: 10pt; margin-bottom: 18px; }
  .status { display: inline-block; padding: 6px 12px; border-radius: 100px; font-weight: 700; font-size: 11pt; background: #1a7f3722; color: #1a7f37; }
  dl { margin: 16px 0 0; padding: 0; }
  dt { color: #777; font-size: 9.5pt; margin-top: 12px; }
  dd { margin: 2px 0 0; font-size: 11pt; }
  .num { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13pt; font-weight: 700; }
  .footer { text-align: center; color: #aaa; font-size: 9pt; margin-top: 24px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${esc(p.typeLabel)}</h1>
    <div class="sub">${esc(p.clinic)}${p.clinicPhone ? " · " + esc(p.clinicPhone) : ""}</div>
    <span class="status">ПОДЛИННЫЙ ДОКУМЕНТ</span>
    <dl>
      ${p.number ? `<dt>Номер</dt><dd class="num">${esc(p.number)}</dd>` : ""}
      <dt>Пациент</dt><dd>${esc(p.patientMasked)}</dd>
      ${p.doctor ? `<dt>Врач</dt><dd>${esc(p.doctor)}</dd>` : ""}
      <dt>Дата</dt><dd>${esc(issuedDt.toLocaleDateString("ru-RU", dateFmt))}</dd>
    </dl>
  </div>
  <div class="footer">Сервис проверки документов MedBook</div>
</body>
</html>`;
}

function notFoundHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Документ не найден</title>
<style>
  body { font-family: -apple-system, sans-serif; padding: 40px 20px; text-align: center; color: #555; }
  h1 { color: #c00; font-size: 18pt; }
</style></head>
<body><h1>Документ не найден</h1><p>Возможно, QR повреждён или ссылка устарела.</p></body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
