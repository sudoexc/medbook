import { auth } from "@/lib/auth";
import { isAuthorizedOrPin } from "@/lib/auth-or-pin";

const RECEPTIONIST_PIN = process.env.RECEPTIONIST_PIN || "8868";
import { prisma } from "@/lib/prisma";
import { sendMessage, escapeHtml } from "@/lib/telegram";
import { z } from "zod";

const ActionSchema = z.object({
  action: z.enum(["start", "complete", "skip", "cancel"]),
  notes: z.string().max(2000).optional(),
  // EMR fields (on complete)
  complaints: z.string().max(5000).optional(),
  diagnosis: z.string().max(5000).optional(),
  prescriptions: z.string().max(5000).optional(),
  recommendations: z.string().max(5000).optional(),
  // Payment fields (on complete)
  paymentAmount: z.number().int().min(0).optional(),
  paymentMethod: z.enum(["CASH", "CARD", "TRANSFER"]).optional(),
  paymentStatus: z.enum(["UNPAID", "PAID"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthorizedOrPin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = ActionSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: { patient: true, doctor: true },
  });
  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Ownership check: doctors can only modify their own appointments.
  // Admin/receptionist (PIN or session) can modify any.
  const pin = request.headers.get("x-terminal-pin");
  if (pin !== RECEPTIONIST_PIN) {
    const session = await auth();
    if (session?.user?.role === "DOCTOR" && session.user.doctorId !== appointment.doctorId) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { action, notes, complaints, diagnosis, prescriptions, recommendations, paymentAmount, paymentMethod, paymentStatus } = parsed.data;

  switch (action) {
    case "start": {
      // Complete any currently in-progress appointment for this doctor
      await prisma.appointment.updateMany({
        where: {
          doctorId: appointment.doctorId,
          queueStatus: "IN_PROGRESS",
          id: { not: id },
        },
        data: {
          queueStatus: "COMPLETED",
          completedAt: new Date(),
        },
      });

      const updated = await prisma.appointment.update({
        where: { id },
        data: { queueStatus: "IN_PROGRESS", startedAt: new Date() },
      });

      // Notify patient via Telegram
      if (appointment.patient.telegramChatId) {
        sendMessage(
          appointment.patient.telegramChatId,
          `🟢 <b>Ваша очередь!</b>\n\nПроходите к врачу: ${escapeHtml(appointment.doctor.nameRu)}\nКабинет: ${appointment.doctor.cabinet}`
        ).catch(() => {});
      }

      return Response.json(updated);
    }

    case "complete": {
      const now = new Date();
      const durationMin = appointment.startedAt
        ? Math.round((now.getTime() - appointment.startedAt.getTime()) / 60000)
        : null;

      const updated = await prisma.appointment.update({
        where: { id },
        data: { queueStatus: "COMPLETED", completedAt: now, durationMin, notes: notes || undefined },
      });

      // Save medical record if any EMR fields provided
      if (complaints || diagnosis || prescriptions || recommendations) {
        await prisma.medicalRecord.upsert({
          where: { appointmentId: id },
          create: { appointmentId: id, complaints, diagnosis, prescriptions, recommendations },
          update: { complaints, diagnosis, prescriptions, recommendations },
        });
      }

      // Save payment if amount provided
      if (paymentAmount !== undefined && paymentAmount > 0) {
        await prisma.payment.upsert({
          where: { appointmentId: id },
          create: {
            appointmentId: id,
            amount: paymentAmount,
            method: paymentMethod || "CASH",
            status: paymentStatus || "UNPAID",
            paidAt: paymentStatus === "PAID" ? now : null,
          },
          update: {
            amount: paymentAmount,
            ...(paymentMethod ? { method: paymentMethod } : {}),
            ...(paymentStatus ? { status: paymentStatus, paidAt: paymentStatus === "PAID" ? now : null } : {}),
          },
        });
      }

      return Response.json(updated);
    }

    case "skip": {
      const updated = await prisma.appointment.update({
        where: { id },
        data: { queueStatus: "SKIPPED" },
      });
      return Response.json(updated);
    }

    case "cancel": {
      const updated = await prisma.appointment.update({
        where: { id },
        data: { queueStatus: "CANCELLED" },
      });
      return Response.json(updated);
    }
  }
}
