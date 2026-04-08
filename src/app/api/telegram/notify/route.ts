import { prisma } from "@/lib/prisma";
import { sendMessage, escapeHtml } from "@/lib/telegram";

// GET /api/telegram/notify — send reminders for upcoming appointments
// Called by Vercel Cron every 30 minutes
export async function GET(request: Request) {
  // Simple auth via secret
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET && request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const sent: string[] = [];

  // 1) Remind 1 hour before
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);
  const in1h30 = new Date(now.getTime() + 90 * 60 * 1000);

  const upcoming1h = await prisma.appointment.findMany({
    where: {
      date: { gte: in1h, lt: in1h30 },
      queueStatus: "WAITING",
      patient: { telegramChatId: { not: null } },
    },
    include: { patient: true, doctor: true },
  });

  for (const appt of upcoming1h) {
    if (!appt.patient.telegramChatId) continue;
    const timeStr = appt.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    await sendMessage(
      appt.patient.telegramChatId,
      `⏰ <b>Напоминание!</b>\n\nВаш приём через 1 час в <b>${timeStr}</b>\nВрач: ${escapeHtml(appt.doctor.nameRu)}\nКабинет: ${appt.doctor.cabinet}\n${appt.service ? `Услуга: ${escapeHtml(appt.service)}` : ""}`
    );
    sent.push(`1h: ${appt.patient.fullName}`);
  }

  // 2) Remind 24 hours before (morning batch 08:00-08:30 window)
  const tomorrowSameTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowPlus30 = new Date(tomorrowSameTime.getTime() + 30 * 60 * 1000);

  // Only send 24h reminders in the morning window (Tashkent UTC+5: 03:00-03:30 UTC)
  const hourUTC = now.getUTCHours();
  if (hourUTC >= 3 && hourUTC < 4) {
    const tomorrowStart = new Date(now);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const upcoming24h = await prisma.appointment.findMany({
      where: {
        date: { gte: tomorrowStart, lt: tomorrowEnd },
        queueStatus: "WAITING",
        patient: { telegramChatId: { not: null } },
      },
      include: { patient: true, doctor: true },
    });

    for (const appt of upcoming24h) {
      if (!appt.patient.telegramChatId) continue;
      const dateStr = appt.date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
      const timeStr = appt.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      await sendMessage(
        appt.patient.telegramChatId,
        `📅 <b>Напоминание на завтра</b>\n\nУ вас приём <b>${dateStr}</b> в <b>${timeStr}</b>\nВрач: ${escapeHtml(appt.doctor.nameRu)}\nКабинет: ${appt.doctor.cabinet}\n${appt.service ? `Услуга: ${escapeHtml(appt.service)}` : ""}`
      );
      sent.push(`24h: ${appt.patient.fullName}`);
    }
  }

  return Response.json({ ok: true, sent: sent.length, details: sent });
}
