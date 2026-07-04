import QRCode from "qrcode";

import { prisma } from "@/lib/prisma";
import { SITE_DOMAIN } from "@/lib/constants";
import { initials } from "@/lib/format";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { AutoPrint } from "./_components/auto-print";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Public, unauthenticated page reachable by raw CUID — never expose full
  // PHI. The patient name is masked to initials (mirrors /api/queue/status),
  // and only the fields the printed stub actually needs are selected.
  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      queueOrder: true,
      queuedAt: true,
      date: true,
      time: true,
      channel: true,
      doctorId: true,
      patient: { select: { fullName: true } },
      doctor: {
        select: {
          id: true,
          nameRu: true,
          cabinet: { select: { number: true } },
        },
      },
      primaryService: { select: { nameRu: true } },
    },
  });

  if (!appointment) {
    return <p style={{ padding: 40, textAlign: "center" }}>Талон не найден</p>;
  }

  // Nullable under two-lanes: a booking printed before check-in has no queue
  // fields — the stub leads with its slot time instead of a fake "C-000".
  const ticketNumber = ticketNumberFor(appointment.doctor.id, appointment.queueOrder);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${SITE_DOMAIN}`;
  const statusUrl = `${baseUrl}/q/${id}`;
  // Self-hosted QR (the `qrcode` package, same one the PDFs/mini-app use) —
  // no third-party `api.qrserver.com` round-trip, which both leaks the queue
  // URL and is unreliable from a VPS behind SNI/DPI filtering.
  const qrUrl = await QRCode.toDataURL(statusUrl, { width: 200, margin: 1 });
  const dateStr = appointment.date.toLocaleDateString("ru-RU");
  const timeStr = appointment.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  // Two-lanes (docs/TZ-two-lanes.md): only a walk-in has a queue position.
  // A booking's stub shows its slot time instead of «перед вами».
  const live = appointment.channel === "WALKIN";
  // Live-lane FIFO count in Tashkent day bounds (server runs UTC — a naive
  // local-midnight window skews ±5h). Ahead = joined earlier (queuedAt).
  const { dayStart, dayEnd } = tashkentDayBounds(new Date());
  const waitingAhead =
    live && appointment.queuedAt
      ? await prisma.appointment.count({
          where: {
            doctorId: appointment.doctorId,
            date: { gte: dayStart, lt: dayEnd },
            queueStatus: "WAITING",
            channel: "WALKIN",
            queuedAt: { lt: appointment.queuedAt },
          },
        })
      : null;

  return (
    <div
      style={{
        width: "80mm",
        minHeight: "120mm",
        margin: "0 auto",
        padding: "5mm",
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        color: "#000",
        background: "#fff",
      }}
    >
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          @page { size: 80mm auto; margin: 2mm; }
        }
        @media screen {
          body { background: #f0f0f0; }
        }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
        <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px" }}>NEUROFAX-B</div>
        <div style={{ fontSize: "9px", color: "#666", marginTop: "1mm" }}>Неврологический центр</div>
      </div>

      {/* Ticket number — BIG */}
      <div style={{ textAlign: "center", margin: "4mm 0" }}>
        <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "2px" }}>{ticketNumber ? "Ваш номер" : "Ваше время"}</div>
        <div style={{ fontSize: "48px", fontWeight: "bold", lineHeight: "1.1", letterSpacing: "2px" }}>{ticketNumber ?? appointment.time ?? timeStr}</div>
      </div>

      {/* Separator */}
      <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

      {/* Details */}
      <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Пациент:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{initials(appointment.patient.fullName)}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Врач:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{appointment.doctor.nameRu}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Кабинет:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold", fontSize: "14px" }}>{appointment.doctor.cabinet?.number ?? "—"}</td>
          </tr>
          {appointment.primaryService && (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>Услуга:</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{appointment.primaryService.nameRu}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Дата:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{dateStr} {timeStr}</td>
          </tr>
          {waitingAhead !== null ? (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>Перед вами:</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{waitingAhead} чел.</td>
            </tr>
          ) : (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>Приём по записи:</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{appointment.time ?? timeStr}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Separator */}
      <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

      {/* QR Code */}
      <div style={{ textAlign: "center", margin: "3mm 0" }}>
        <img
          src={qrUrl}
          alt="QR"
          width={140}
          height={140}
          style={{ display: "inline-block" }}
        />
        <div style={{ fontSize: "8px", color: "#999", marginTop: "1.5mm" }}>
          Отсканируйте для отслеживания очереди
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", borderTop: "1px dashed #000", paddingTop: "3mm", marginTop: "3mm" }}>
        <div style={{ fontSize: "9px", color: "#666" }}>Спасибо за визит!</div>
        <div style={{ fontSize: "8px", color: "#999", marginTop: "1mm" }}>+998 71 200 00 07 | neurofax.uz</div>
      </div>

      <AutoPrint />
    </div>
  );
}
