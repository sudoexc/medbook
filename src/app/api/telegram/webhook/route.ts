import { prisma } from "@/lib/prisma";
import { sendMessage, escapeHtml } from "@/lib/telegram";

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    contact?: { phone_number: string };
  };
}

const TEXTS = {
  welcome: `👋 <b>NeuroFax-B Диагностический центр</b>\n\nОтправьте свой номер телефона, чтобы привязать аккаунт и получать напоминания о визитах.`,
  sharePhone: "📱 Отправить номер телефона",
  linked: `✅ Аккаунт привязан! Теперь вы будете получать напоминания о визитах.\n\nКоманды:\n/queue — ваша позиция в очереди\n/appointments — ближайшие записи\n/help — помощь`,
  notFound: "❌ Пациент с таким номером не найден. Обратитесь в клинику для регистрации.",
  noAppointments: "📋 У вас нет предстоящих записей.",
  notLinked: "⚠️ Сначала привяжите аккаунт — отправьте /start",
  help: `<b>Команды бота:</b>\n\n/start — привязать аккаунт\n/queue — позиция в очереди\n/appointments — ближайшие записи\n/help — помощь\n\n📞 Телефон: +998 71 200 00 07`,
};

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "").replace(/^(\d)/, "+$1");
}

// Telegram delivers `X-Telegram-Bot-Api-Secret-Token` on every update if you
// set a `secret_token` when calling setWebhook. We require it in production.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

export async function POST(request: Request) {
  if (WEBHOOK_SECRET) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== WEBHOOK_SECRET) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return Response.json({ ok: true });
  }
  const msg = update.message;
  if (!msg) return Response.json({ ok: true });

  const chatId = String(msg.chat.id);
  const text = msg.text?.trim() || "";

  // Handle contact sharing (phone button)
  if (msg.contact) {
    const phone = normalizePhone(msg.contact.phone_number);
    await linkPatient(chatId, phone);
    return Response.json({ ok: true });
  }

  // Handle commands
  if (text === "/start") {
    await sendMessage(chatId, TEXTS.welcome, {
      reply_markup: {
        keyboard: [[{ text: TEXTS.sharePhone, request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } else if (text === "/queue") {
    await handleQueue(chatId);
  } else if (text === "/appointments") {
    await handleAppointments(chatId);
  } else if (text === "/help") {
    await sendMessage(chatId, TEXTS.help);
  } else if (text.startsWith("+998") || text.match(/^\d{9,}/)) {
    // Manual phone entry
    const phone = normalizePhone(text);
    await linkPatient(chatId, phone);
  } else {
    await sendMessage(chatId, TEXTS.help);
  }

  return Response.json({ ok: true });
}

async function linkPatient(chatId: string, phone: string) {
  // Try multiple phone formats
  const variants = [phone, phone.replace("+", ""), `+998${phone.slice(-9)}`];

  let patient = null;
  for (const p of variants) {
    patient = await prisma.patient.findUnique({ where: { phone: p } });
    if (patient) break;
  }

  if (!patient) {
    await sendMessage(chatId, TEXTS.notFound);
    return;
  }

  await prisma.patient.update({
    where: { id: patient.id },
    data: { telegramChatId: chatId },
  });

  await sendMessage(chatId, `${TEXTS.linked}\n\n👤 ${escapeHtml(patient.fullName)}`, {
    reply_markup: { remove_keyboard: true },
  });
}

async function handleQueue(chatId: string) {
  const patient = await prisma.patient.findUnique({ where: { telegramChatId: chatId } });
  if (!patient) {
    await sendMessage(chatId, TEXTS.notLinked);
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const myAppointment = await prisma.appointment.findFirst({
    where: {
      patientId: patient.id,
      date: { gte: today, lt: tomorrow },
      queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
    },
    include: { doctor: true },
  });

  if (!myAppointment) {
    await sendMessage(chatId, "📋 Вы сегодня не записаны в очередь.");
    return;
  }

  if (myAppointment.queueStatus === "IN_PROGRESS") {
    await sendMessage(chatId, `🟢 <b>Вас ожидают!</b>\nВрач: ${escapeHtml(myAppointment.doctor.nameRu)}\nКабинет: ${myAppointment.doctor.cabinet}`);
    return;
  }

  // Count how many are before me
  const ahead = await prisma.appointment.count({
    where: {
      doctorId: myAppointment.doctorId,
      date: { gte: today, lt: tomorrow },
      queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
      queueOrder: { lt: myAppointment.queueOrder ?? 999 },
    },
  });

  await sendMessage(chatId, `⏳ <b>Ваша очередь</b>\n\nВрач: ${escapeHtml(myAppointment.doctor.nameRu)}\nПеред вами: <b>${ahead}</b> чел.\nКабинет: ${myAppointment.doctor.cabinet}`);
}

async function handleAppointments(chatId: string) {
  const patient = await prisma.patient.findUnique({ where: { telegramChatId: chatId } });
  if (!patient) {
    await sendMessage(chatId, TEXTS.notLinked);
    return;
  }

  const now = new Date();
  const appointments = await prisma.appointment.findMany({
    where: {
      patientId: patient.id,
      date: { gte: now },
      queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
    },
    include: { doctor: true },
    orderBy: { date: "asc" },
    take: 5,
  });

  if (appointments.length === 0) {
    await sendMessage(chatId, TEXTS.noAppointments);
    return;
  }

  let msg = "📅 <b>Ваши записи:</b>\n\n";
  for (const appt of appointments) {
    const d = appt.date;
    const dateStr = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const timeStr = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    msg += `• <b>${dateStr}</b> в ${timeStr}\n  ${escapeHtml(appt.doctor.nameRu)}, каб. ${appt.doctor.cabinet}\n  ${appt.service ? escapeHtml(appt.service) : ""}\n\n`;
  }

  await sendMessage(chatId, msg);
}
