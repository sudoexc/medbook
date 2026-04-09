import { prisma } from "./prisma";

/**
 * Tashkent is UTC+5 year-round (no DST).
 * All appointment times are stored as UTC in DB but reasoned about as
 * "Tashkent wall clock" in the UI and business logic.
 */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Construct a UTC-backed Date from Tashkent wall clock components.
 * Example: toTashkentDate("2026-04-09", "09:00") → Date representing 04:00 UTC.
 */
export function toTashkentDate(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00+05:00`);
}

/**
 * Return Tashkent wall clock components for "now".
 */
export function tashkentNow() {
  return tashkentComponents(new Date());
}

/**
 * Convert any Date to Tashkent wall clock components.
 */
export function tashkentComponents(date: Date) {
  const t = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mi = String(t.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${mi}`,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes(),
    dow: t.getUTCDay(), // 0 = Sunday
    timestamp: date.getTime(),
  };
}

export type BookingValidationError =
  | "INVALID_DATE"
  | "PAST_DATE"
  | "DAY_OFF"
  | "NOT_WORKING_DAY"
  | "OUT_OF_HOURS"
  | "SLOT_TAKEN"
  | "DOCTOR_NOT_FOUND";

export interface BookingValidationResult {
  ok: boolean;
  code?: BookingValidationError;
  message?: string;
  messageUz?: string;
}

const MESSAGES: Record<BookingValidationError, { ru: string; uz: string }> = {
  INVALID_DATE: { ru: "Неверная дата", uz: "Noto'g'ri sana" },
  PAST_DATE: {
    ru: "Нельзя записаться на прошедшее время",
    uz: "O'tgan vaqtga yozib bo'lmaydi",
  },
  DAY_OFF: {
    ru: "У врача выходной в этот день",
    uz: "Shifokorning dam olish kuni",
  },
  NOT_WORKING_DAY: {
    ru: "Врач не принимает в этот день недели",
    uz: "Shifokor bu kuni qabul qilmaydi",
  },
  OUT_OF_HOURS: {
    ru: "Время вне рабочих часов врача",
    uz: "Shifokorning ish vaqtidan tashqari",
  },
  SLOT_TAKEN: {
    ru: "Это время уже занято другим пациентом",
    uz: "Bu vaqt band",
  },
  DOCTOR_NOT_FOUND: { ru: "Врач не найден", uz: "Shifokor topilmadi" },
};

function fail(code: BookingValidationError): BookingValidationResult {
  return {
    ok: false,
    code,
    message: MESSAGES[code].ru,
    messageUz: MESSAGES[code].uz,
  };
}

/**
 * Validates an appointment booking against:
 *   - Valid date
 *   - Not in the past (5-minute grace)
 *   - Doctor exists
 *   - Doctor's day-of-week schedule active
 *   - Not a doctor day off
 *   - Time within working hours
 *   - Slot not already taken
 */
export async function validateBookingSlot(params: {
  doctorId: string;
  date: Date;
  excludeAppointmentId?: string;
}): Promise<BookingValidationResult> {
  const { doctorId, date, excludeAppointmentId } = params;

  if (isNaN(date.getTime())) return fail("INVALID_DATE");

  // 5-minute grace for clock skew
  const now = Date.now();
  if (date.getTime() < now - 5 * 60 * 1000) return fail("PAST_DATE");

  const comp = tashkentComponents(date);
  const dayStart = new Date(`${comp.date}T00:00:00+05:00`);
  const dayEnd = new Date(`${comp.date}T23:59:59+05:00`);
  const slotStart = new Date(date.getTime() - 60 * 1000);
  const slotEnd = new Date(date.getTime() + 60 * 1000);

  // Run all four checks in parallel — they're independent. ~4× faster.
  const [doctor, dayOff, schedule, existing] = await Promise.all([
    prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { id: true },
    }),
    prisma.doctorDayOff.findFirst({
      where: { doctorId, date: { gte: dayStart, lte: dayEnd } },
      select: { id: true },
    }),
    prisma.doctorSchedule.findUnique({
      where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: comp.dow } },
      select: { startTime: true, endTime: true, isActive: true },
    }),
    prisma.appointment.findFirst({
      where: {
        doctorId,
        date: { gte: slotStart, lte: slotEnd },
        queueStatus: { notIn: ["CANCELLED", "SKIPPED"] },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { id: true },
    }),
  ]);

  if (!doctor) return fail("DOCTOR_NOT_FOUND");
  if (dayOff) return fail("DAY_OFF");
  if (!schedule || !schedule.isActive) return fail("NOT_WORKING_DAY");

  const [startH, startM] = schedule.startTime.split(":").map(Number);
  const [endH, endM] = schedule.endTime.split(":").map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;
  if (comp.minutes < startMin || comp.minutes >= endMin) {
    return fail("OUT_OF_HOURS");
  }

  if (existing) return fail("SLOT_TAKEN");

  return { ok: true };
}
