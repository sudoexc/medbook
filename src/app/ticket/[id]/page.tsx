import { prisma } from "@/lib/prisma";
import { SITE_DOMAIN } from "@/lib/constants";
import { AutoPrint } from "@/components/auto-print";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { patient: true, doctor: true },
  });

  if (!appointment) {
    return <p style={{ padding: 40, textAlign: "center" }}>Талон не найден</p>;
  }

  const ticketNumber = `${appointment.doctor.id.charAt(0).toUpperCase()}-${String(appointment.queueOrder || 0).padStart(3, "0")}`;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${SITE_DOMAIN}`;
  const statusUrl = `${baseUrl}/q/${id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(statusUrl)}`;
  const dateStr = appointment.date.toLocaleDateString("ru-RU");
  const timeStr = appointment.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  // Count waiting ahead
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const waitingAhead = await prisma.appointment.count({
    where: {
      doctorId: appointment.doctorId,
      date: { gte: today, lt: tomorrow },
      queueStatus: "WAITING",
      queueOrder: { lt: appointment.queueOrder || 9999 },
    },
  });

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
        <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "2px" }}>Ваш номер</div>
        <div style={{ fontSize: "48px", fontWeight: "bold", lineHeight: "1.1", letterSpacing: "2px" }}>{ticketNumber}</div>
      </div>

      {/* Separator */}
      <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

      {/* Details */}
      <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Пациент:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{appointment.patient.fullName}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Врач:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{appointment.doctor.nameRu}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Кабинет:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold", fontSize: "14px" }}>{appointment.doctor.cabinet}</td>
          </tr>
          {appointment.service && (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>Услуга:</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{appointment.service}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Дата:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{dateStr} {timeStr}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>Перед вами:</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{waitingAhead} чел.</td>
          </tr>
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
