/**
 * Phase 15 Wave 3 — `findFreeSlots` tool.
 *
 * READ-ONLY. Computes free hourly windows for a doctor / specialty across the
 * requested date range, intersecting `DoctorSchedule` (working hours per
 * weekday) minus existing `Appointment` rows. The result is capped at 5 slots
 * — enough for the LLM to mention them inline; the user clicks a deeplink to
 * jump into the calendar where they can actually book.
 *
 * Behaviour notes:
 *   - We do NOT consider `DoctorTimeOff`. The point of this tool is to give
 *     the LLM a quick "yes there's likely room at X" signal for chat. The
 *     real booking flow runs `validateBooking()` which checks time-off /
 *     overlap with full strictness. Worst case the user clicks the chip,
 *     calendar shows the slot already busy, no harm done.
 *   - Granularity is 1 hour. Real durations vary (15..60 min), but for an
 *     "is the doctor likely free at 14:00 tomorrow" answer the hour bucket
 *     is the right grain.
 *   - `preferredTimeOfDay` collapses to hour ranges:
 *       morning:   [8,  12)
 *       afternoon: [12, 17)
 *       evening:   [17, 21)
 */

import { prisma } from "@/lib/prisma";
import type { Tool, ToolContext, ToolResult } from "./types";

type FindFreeSlotsInput = {
  specialty?: string;
  doctorId?: string;
  /** ISO-8601 date (YYYY-MM-DD) — start of the search window. */
  dateFrom?: string;
  /** ISO-8601 date (YYYY-MM-DD) — end of the search window (inclusive). */
  dateTo?: string;
  preferredTimeOfDay?: "morning" | "afternoon" | "evening";
};

const TIME_OF_DAY: Record<
  NonNullable<FindFreeSlotsInput["preferredTimeOfDay"]>,
  { startHour: number; endHour: number }
> = {
  morning: { startHour: 8, endHour: 12 },
  afternoon: { startHour: 12, endHour: 17 },
  evening: { startHour: 17, endHour: 21 },
};

const MAX_SLOTS = 5;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number(v));
  return (h ?? 0) + (m ?? 0) / 60;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const findFreeSlotsTool: Tool<FindFreeSlotsInput> = {
  name: "findFreeSlots",
  description:
    "Find free appointment slots by specialty, doctor, or time range. Use when the user asks about availability, empty windows, or whether a doctor is free at a specific time. Returns up to 5 hourly slots within the next week by default.",
  input_schema: {
    type: "object",
    properties: {
      specialty: {
        type: "string",
        description:
          "Doctor specialty in Russian or Uzbek (e.g. 'невролог', 'nevrolog'). Matched as case-insensitive substring against the specialization field.",
      },
      doctorId: {
        type: "string",
        description: "Specific doctor's CUID. Use when the user names a doctor.",
      },
      dateFrom: {
        type: "string",
        description:
          "ISO date YYYY-MM-DD. Start of search window. Defaults to today.",
      },
      dateTo: {
        type: "string",
        description:
          "ISO date YYYY-MM-DD. End of search window (inclusive). Defaults to today + 7 days.",
      },
      preferredTimeOfDay: {
        type: "string",
        enum: ["morning", "afternoon", "evening"],
        description:
          "Time-of-day filter. morning=8-12, afternoon=12-17, evening=17-21.",
      },
    },
    additionalProperties: false,
  },
  execute: async (
    input: FindFreeSlotsInput,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const today = startOfDay(new Date());
    const dateFrom = input.dateFrom
      ? startOfDay(new Date(input.dateFrom))
      : today;
    const defaultTo = new Date(today);
    defaultTo.setDate(defaultTo.getDate() + 7);
    const dateTo = input.dateTo
      ? startOfDay(new Date(input.dateTo))
      : defaultTo;

    if (
      Number.isNaN(dateFrom.getTime()) ||
      Number.isNaN(dateTo.getTime()) ||
      dateTo < dateFrom
    ) {
      return {
        ok: false,
        data: null,
        summary:
          context.locale === "ru"
            ? "Не удалось разобрать диапазон дат."
            : "Sana oraliqlarini o'qib bo'lmadi.",
      };
    }

    // Pull doctors first. Filter by clinic via the tenant extension. We
    // have to also constrain by clinicId explicitly because some test
    // contexts skip the extension; harmless when the extension is on.
    const doctors = await prisma.doctor.findMany({
      where: {
        clinicId: context.clinicId,
        isActive: true,
        ...(input.doctorId ? { id: input.doctorId } : {}),
        ...(input.specialty
          ? {
              OR: [
                { specializationRu: { contains: input.specialty, mode: "insensitive" } },
                { specializationUz: { contains: input.specialty, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        specializationRu: true,
        specializationUz: true,
      },
      take: 10,
    });

    if (doctors.length === 0) {
      return {
        ok: true,
        data: { slots: [] },
        summary:
          context.locale === "ru"
            ? "Не нашёл врачей по запрошенным критериям."
            : "So'ralgan mezonlar bo'yicha shifokorlar topilmadi.",
        chips: [],
      };
    }

    const todHours = input.preferredTimeOfDay
      ? TIME_OF_DAY[input.preferredTimeOfDay]
      : { startHour: 8, endHour: 21 };

    // For each doctor pull schedule + appointments in the window in
    // parallel; then walk hour-by-hour to find empty buckets.
    const dayEnd = new Date(dateTo);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [schedulesByDoctor, apptsByDoctor] = await Promise.all([
      prisma.doctorSchedule.findMany({
        where: {
          clinicId: context.clinicId,
          isActive: true,
          doctorId: { in: doctors.map((d) => d.id) },
        },
        select: {
          doctorId: true,
          weekday: true,
          startTime: true,
          endTime: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          clinicId: context.clinicId,
          doctorId: { in: doctors.map((d) => d.id) },
          date: { gte: dateFrom, lt: dayEnd },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        select: { doctorId: true, date: true, durationMin: true },
      }),
    ]);

    const scheduleMap = new Map<string, { weekday: number; start: number; end: number }[]>();
    for (const s of schedulesByDoctor) {
      const arr = scheduleMap.get(s.doctorId) ?? [];
      arr.push({
        weekday: s.weekday,
        start: parseHHMM(s.startTime),
        end: parseHHMM(s.endTime),
      });
      scheduleMap.set(s.doctorId, arr);
    }
    const apptHourSet = new Set<string>();
    const now = Date.now();
    for (const a of apptsByDoctor) {
      const h = a.date.getHours();
      apptHourSet.add(`${a.doctorId}|${ymd(a.date)}|${h}`);
    }

    type FreeSlot = {
      doctorId: string;
      doctorName: string;
      specialty: string;
      date: string;
      hour: number;
      deeplink: string;
    };
    const free: FreeSlot[] = [];

    outer: for (const doc of doctors) {
      const schedules = scheduleMap.get(doc.id) ?? [];
      for (
        let day = new Date(dateFrom);
        day <= dateTo;
        day.setDate(day.getDate() + 1)
      ) {
        const wd = day.getDay();
        const winsForDay = schedules.filter((s) => s.weekday === wd);
        if (winsForDay.length === 0) continue;
        for (const w of winsForDay) {
          const startH = Math.max(Math.floor(w.start), todHours.startHour);
          const endH = Math.min(Math.ceil(w.end), todHours.endHour);
          for (let h = startH; h < endH; h++) {
            const key = `${doc.id}|${ymd(day)}|${h}`;
            if (apptHourSet.has(key)) continue;
            // Skip slots already in the past for today.
            const slotMs = new Date(day).setHours(h, 0, 0, 0);
            if (slotMs < now) continue;
            const docName =
              context.locale === "uz" && doc.nameUz ? doc.nameUz : doc.nameRu;
            const specialty =
              context.locale === "uz" && doc.specializationUz
                ? doc.specializationUz
                : doc.specializationRu;
            free.push({
              doctorId: doc.id,
              doctorName: docName,
              specialty,
              date: ymd(day),
              hour: h,
              deeplink: `/crm/calendar?doctor=${encodeURIComponent(
                doc.id,
              )}&date=${ymd(day)}`,
            });
            if (free.length >= MAX_SLOTS) break outer;
          }
        }
      }
    }

    const summary =
      free.length === 0
        ? context.locale === "ru"
          ? "Свободных окон по запросу не найдено."
          : "So'rov bo'yicha bo'sh oynalar topilmadi."
        : context.locale === "ru"
          ? `Найдено ${free.length} свободных окон. Ближайшее: ${free[0]!.doctorName}, ${free[0]!.date} в ${String(free[0]!.hour).padStart(2, "0")}:00.`
          : `${free.length} ta bo'sh oyna topildi. Eng yaqini: ${free[0]!.doctorName}, ${free[0]!.date} soat ${String(free[0]!.hour).padStart(2, "0")}:00.`;

    return {
      ok: true,
      data: { slots: free },
      summary,
      chips: free.map((s) => ({
        kind: "slot" as const,
        label: `${s.doctorName} · ${s.date} ${String(s.hour).padStart(2, "0")}:00`,
        deeplink: s.deeplink,
      })),
    };
  },
};
