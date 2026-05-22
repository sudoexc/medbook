/**
 * GET /api/verify/sick-leave/[token] — public sick-leave authenticity check.
 *
 * Mirrors /verify/recipe. Returns issuing clinic, doctor, masked patient
 * name, certificate period, status (ISSUED / CANCELLED), and whether the
 * employer can rely on it today. No diagnosis is exposed — confidentiality
 * trumps verification convenience.
 */
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const m = /\/verify\/sick-leave\/([^/?]+)/.exec(request.url);
  if (!m) return new Response("Bad request", { status: 400 });
  const token = decodeURIComponent(m[1]);
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");

  const sl = await prisma.sickLeave.findFirst({
    where: { verifyToken: token },
    include: {
      patient: { select: { fullName: true } },
      doctor: { select: { name: true } },
      clinic: { select: { nameRu: true, phone: true } },
    },
  });

  if (!sl) {
    return wantsJson
      ? Response.json({ ok: false, reason: "not_found" }, { status: 404 })
      : html(notFoundHtml(), 404);
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const inEffect =
    sl.status === "ISSUED" && todayUtc >= sl.periodFrom && todayUtc <= sl.periodTo;

  const payload = {
    ok: true,
    type: "SickLeave",
    certNumber: sl.certNumber,
    clinic: sl.clinic.nameRu,
    clinicPhone: sl.clinic.phone,
    doctor: sl.doctor.name,
    patientMasked: maskName(sl.patient.fullName),
    regimen: sl.regimen,
    periodFrom: dateOnly(sl.periodFrom),
    periodTo: dateOnly(sl.periodTo),
    issuedAt: sl.issuedAt.toISOString(),
    status: sl.status,
    cancelReason: sl.cancelReason,
    inEffectToday: inEffect,
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

function dateOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
  certNumber: string;
  clinic: string;
  clinicPhone: string | null;
  doctor: string;
  patientMasked: string;
  regimen: "OUTPATIENT" | "HOSPITAL" | "HOME";
  periodFrom: string;
  periodTo: string;
  issuedAt: string;
  status: "ISSUED" | "CANCELLED";
  cancelReason: string | null;
  inEffectToday: boolean;
}): string {
  const issuedDt = new Date(p.issuedAt);
  const fromDt = new Date(`${p.periodFrom}T00:00:00.000Z`);
  const toDt = new Date(`${p.periodTo}T00:00:00.000Z`);
  const dateFmt: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "long",
    year: "numeric",
  };
  const statusLabel =
    p.status === "CANCELLED"
      ? "АННУЛИРОВАН"
      : p.inEffectToday
        ? "ДЕЙСТВУЕТ СЕГОДНЯ"
        : "ВНЕ ПЕРИОДА";
  const statusColor =
    p.status === "CANCELLED"
      ? "#c00"
      : p.inEffectToday
        ? "#1a7f37"
        : "#888";
  const regimenLabel =
    p.regimen === "HOSPITAL"
      ? "Стационар"
      : p.regimen === "HOME"
        ? "Постельный режим"
        : "Амбулаторно";

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Проверка листа ${esc(p.certNumber)}</title>
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
    <h1>Лист нетрудоспособности</h1>
    <div class="sub">${esc(p.clinic)}${p.clinicPhone ? " · " + esc(p.clinicPhone) : ""}</div>
    <span class="status" style="background: ${statusColor}22; color: ${statusColor};">${esc(statusLabel)}</span>
    ${p.cancelReason ? `<div class="reason"><b>Причина отмены:</b> ${esc(p.cancelReason)}</div>` : ""}
    <dl>
      <dt>Номер</dt><dd class="num">${esc(p.certNumber)}</dd>
      <dt>Пациент</dt><dd>${esc(p.patientMasked)}</dd>
      <dt>Врач</dt><dd>${esc(p.doctor)}</dd>
      <dt>Период</dt><dd><b>с ${esc(fromDt.toLocaleDateString("ru-RU", dateFmt))} по ${esc(toDt.toLocaleDateString("ru-RU", dateFmt))}</b></dd>
      <dt>Режим</dt><dd>${esc(regimenLabel)}</dd>
      <dt>Выдан</dt><dd>${esc(issuedDt.toLocaleDateString("ru-RU", dateFmt))}</dd>
    </dl>
  </div>
  <div class="footer">Сервис проверки листов нетрудоспособности MedBook</div>
</body>
</html>`;
}

function notFoundHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Лист не найден</title>
<style>
  body { font-family: -apple-system, sans-serif; padding: 40px 20px; text-align: center; color: #555; }
  h1 { color: #c00; font-size: 18pt; }
</style></head>
<body><h1>Лист не найден</h1><p>Возможно, QR повреждён или ссылка устарела.</p></body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
