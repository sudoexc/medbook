/**
 * GET /api/verify/recipe/[token] — public Rx authenticity check.
 *
 * Anonymous endpoint — anyone with the QR can hit it. Returns a short
 * mobile-friendly HTML page (or JSON if `Accept: application/json`) showing:
 *   - issuing clinic name
 *   - doctor name
 *   - patient initials (first letter + last name initial only — keeps PII
 *     out of a publicly-scannable URL while still letting a pharmacist
 *     confirm "this matches the customer in front of me")
 *   - rxNumber, issue/expiry dates
 *   - status: ISSUED / CANCELLED
 *
 * Items are intentionally NOT included — the pharmacist holds the paper
 * with the items; the verify page only confirms the paper itself is real.
 */
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const m = /\/verify\/recipe\/([^/?]+)/.exec(request.url);
  if (!m) return new Response("Bad request", { status: 400 });
  const token = decodeURIComponent(m[1]);
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

  const rx = await prisma.ePrescription.findFirst({
    where: { verifyToken: token },
    include: {
      patient: { select: { fullName: true } },
      doctor: { select: { name: true } },
      clinic: { select: { nameRu: true, phone: true } },
    },
  });

  if (!rx) {
    return wantsJson
      ? Response.json({ ok: false, reason: "not_found" }, { status: 404 })
      : html(notFoundHtml(), 404);
  }

  const initials = maskName(rx.patient.fullName);
  const payload = {
    ok: true,
    type: "EPrescription",
    rxNumber: rx.rxNumber,
    clinic: rx.clinic.nameRu,
    clinicPhone: rx.clinic.phone,
    doctor: rx.doctor.name,
    patientMasked: initials,
    issuedAt: rx.issuedAt.toISOString(),
    validUntilAt: rx.validUntilAt.toISOString(),
    status: rx.status,
    cancelReason: rx.cancelReason,
    expired: rx.validUntilAt < new Date(),
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
  rxNumber: string;
  clinic: string;
  clinicPhone: string | null;
  doctor: string;
  patientMasked: string;
  issuedAt: string;
  validUntilAt: string;
  status: "ISSUED" | "CANCELLED";
  cancelReason: string | null;
  expired: boolean;
}): string {
  const issuedDt = new Date(p.issuedAt);
  const validDt = new Date(p.validUntilAt);
  const dateFmt: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "long",
    year: "numeric",
  };
  const statusLabel =
    p.status === "CANCELLED"
      ? "ОТМЕНЁН"
      : p.expired
        ? "ИСТЁК"
        : "ДЕЙСТВИТЕЛЕН";
  const statusColor =
    p.status === "CANCELLED"
      ? "#c00"
      : p.expired
        ? "#b76e00"
        : "#1a7f37";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Проверка рецепта ${esc(p.rxNumber)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; background: #f6f7f9; color: #111; }
  .card { max-width: 480px; margin: 12px auto; background: white; border-radius: 12px; padding: 22px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
  h1 { margin: 0 0 4px; font-size: 18pt; }
  .sub { color: #888; font-size: 10pt; margin-bottom: 18px; }
  .status { display: inline-block; padding: 6px 12px; border-radius: 100px; font-weight: 700; font-size: 11pt; }
  dl { margin: 16px 0 0; padding: 0; }
  dt { color: #777; font-size: 9.5pt; margin-top: 12px; }
  dd { margin: 2px 0 0; font-size: 11pt; }
  .num { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13pt; font-weight: 700; }
  .reason { background: #fff5f5; border-left: 3px solid #c00; padding: 8px 10px; margin-top: 10px; font-size: 10pt; color: #800; }
  .footer { text-align: center; color: #aaa; font-size: 9pt; margin-top: 24px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Рецепт</h1>
    <div class="sub">${esc(p.clinic)}${p.clinicPhone ? " · " + esc(p.clinicPhone) : ""}</div>
    <span class="status" style="background: ${statusColor}22; color: ${statusColor};">${esc(statusLabel)}</span>
    ${p.cancelReason ? `<div class="reason"><b>Причина отмены:</b> ${esc(p.cancelReason)}</div>` : ""}
    <dl>
      <dt>Номер</dt><dd class="num">${esc(p.rxNumber)}</dd>
      <dt>Пациент</dt><dd>${esc(p.patientMasked)}</dd>
      <dt>Врач</dt><dd>${esc(p.doctor)}</dd>
      <dt>Выписан</dt><dd>${esc(issuedDt.toLocaleDateString("ru-RU", dateFmt))}</dd>
      <dt>Действителен до</dt><dd>${esc(validDt.toLocaleDateString("ru-RU", dateFmt))}</dd>
    </dl>
  </div>
  <div class="footer">Сервис проверки рецептов MedBook</div>
</body>
</html>`;
}

function notFoundHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Рецепт не найден</title>
<style>
  body { font-family: -apple-system, sans-serif; padding: 40px 20px; text-align: center; color: #555; }
  h1 { color: #c00; font-size: 18pt; }
</style></head>
<body><h1>Рецепт не найден</h1><p>Возможно, QR повреждён или ссылка устарела.</p></body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
