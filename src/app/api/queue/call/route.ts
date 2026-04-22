// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { prisma } from "@/lib/prisma";
import { isAuthorizedOrPin } from "@/lib/auth-or-pin";
import { sendMessage, escapeHtml } from "@/lib/telegram";

// How long a call stays "active" on the TV after the receptionist presses call.
const CALL_WINDOW_MS = 15_000;

// GET /api/queue/call — TV polls this to check for an active patient call.
// State is persisted on Appointment.calledAt so it survives Vercel cold starts
// (this was a CRITICAL audit finding against the earlier in-memory store).
export async function GET() {
  const since = new Date(Date.now() - CALL_WINDOW_MS);
  const recent = await prisma.appointment.findFirst({
    where: { calledAt: { gte: since } },
    orderBy: { calledAt: "desc" },
    select: {
      calledAt: true,
      queueOrder: true,
      patient: { select: { fullName: true } },
      doctor: { select: { id: true, nameRu: true, cabinet: true } },
    },
  });

  if (!recent || !recent.calledAt) {
    return Response.json({ call: null });
  }

  const ticketNumber = `${recent.doctor.id.charAt(0).toUpperCase()}${String(recent.queueOrder || 0).padStart(3, "0")}`;
  return Response.json({
    call: {
      fullName: recent.patient.fullName,
      cabinet: recent.doctor.cabinet,
      doctorName: recent.doctor.nameRu,
      ticketNumber,
      calledAt: recent.calledAt.getTime(),
    },
  });
}

// POST /api/queue/call — receptionist/doctor calls a patient.
export async function POST(request: Request) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { appointmentId } = await request.json();
  if (!appointmentId || typeof appointmentId !== "string") {
    return Response.json({ error: "appointmentId required" }, { status: 400 });
  }

  const updated = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { calledAt: new Date() },
    select: {
      calledAt: true,
      queueOrder: true,
      patient: { select: { fullName: true, telegramChatId: true } },
      doctor: { select: { id: true, nameRu: true, cabinet: true } },
    },
  }).catch(() => null);

  if (!updated || !updated.calledAt) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const ticketNumber = `${updated.doctor.id.charAt(0).toUpperCase()}${String(updated.queueOrder || 0).padStart(3, "0")}`;

  if (updated.patient.telegramChatId) {
    sendMessage(
      updated.patient.telegramChatId,
      `📢 <b>Вас вызывают!</b>\n\nПроходите в Кабинет ${updated.doctor.cabinet}\nВрач: ${escapeHtml(updated.doctor.nameRu)}`
    ).catch((err) => console.error("[telegram]", err));
  }

  return Response.json({
    ok: true,
    call: {
      fullName: updated.patient.fullName,
      cabinet: updated.doctor.cabinet,
      doctorName: updated.doctor.nameRu,
      ticketNumber,
      calledAt: updated.calledAt.getTime(),
    },
  });
}
