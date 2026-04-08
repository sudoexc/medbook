import { prisma } from "@/lib/prisma";
import { isAuthorizedOrPin } from "@/lib/auth-or-pin";
import { sendMessage, escapeHtml } from "@/lib/telegram";

// In-memory call store (resets on cold start, fine for real-time calls)
let currentCall: {
  fullName: string;
  cabinet: number;
  doctorName: string;
  ticketNumber: string;
  calledAt: number;
} | null = null;

// GET /api/queue/call — TV polls this to check for active calls
export async function GET() {
  // Clear call after 15 seconds
  if (currentCall && Date.now() - currentCall.calledAt > 15000) {
    currentCall = null;
  }
  return Response.json({ call: currentCall });
}

// POST /api/queue/call — receptionist/doctor calls a patient
export async function POST(request: Request) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { appointmentId } = await request.json();

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true, doctor: true },
  });

  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const ticketNumber = `${appointment.doctor.id.charAt(0).toUpperCase()}${String(appointment.queueOrder || 0).padStart(3, "0")}`;

  currentCall = {
    fullName: appointment.patient.fullName,
    cabinet: appointment.doctor.cabinet,
    doctorName: appointment.doctor.nameRu,
    ticketNumber,
    calledAt: Date.now(),
  };

  // Also notify via Telegram
  if (appointment.patient.telegramChatId) {
    sendMessage(
      appointment.patient.telegramChatId,
      `📢 <b>Вас вызывают!</b>\n\nПроходите в Кабинет ${appointment.doctor.cabinet}\nВрач: ${escapeHtml(appointment.doctor.nameRu)}`
    ).catch(() => {});
  }

  return Response.json({ ok: true, call: currentCall });
}
