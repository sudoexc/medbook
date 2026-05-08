/**
 * Phase 15 Wave 3 — `getAppointmentsToday` tool.
 *
 * READ-ONLY. Returns today's appointments (Tashkent local day boundary, but
 * we use the server's local day; the calendar normalises to TZ already, so
 * for the LLM "today" answer this is fine). Up to 20 rows, each with a
 * `/crm/calendar?focus={id}` deeplink.
 *
 * Filters:
 *   - doctorId — narrow to one doctor.
 *   - status   — one of the AppointmentStatus enum values.
 */

import { prisma } from "@/lib/prisma";
import type { Tool, ToolContext, ToolResult } from "./types";

const APPOINTMENT_STATUSES = [
  "BOOKED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "NO_SHOW",
] as const;
type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

type GetAppointmentsTodayInput = {
  doctorId?: string;
  status?: AppointmentStatus;
};

const MAX_RESULTS = 20;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export const getAppointmentsTodayTool: Tool<GetAppointmentsTodayInput> = {
  name: "getAppointmentsToday",
  description:
    "List today's appointments, optionally filtered by doctor or status. Use when the user asks 'how many appointments today' or 'what's on the schedule today'. Returns up to 20 entries.",
  input_schema: {
    type: "object",
    properties: {
      doctorId: {
        type: "string",
        description: "Optional doctor CUID to narrow the list.",
      },
      status: {
        type: "string",
        enum: [...APPOINTMENT_STATUSES],
        description:
          "Optional appointment status filter (BOOKED, WAITING, IN_PROGRESS, COMPLETED, SKIPPED, CANCELLED, NO_SHOW).",
      },
    },
    additionalProperties: false,
  },
  execute: async (
    input: GetAppointmentsTodayInput,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const today = startOfDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const rows = await prisma.appointment.findMany({
      where: {
        clinicId: context.clinicId,
        date: { gte: today, lt: tomorrow },
        ...(input.doctorId ? { doctorId: input.doctorId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      select: {
        id: true,
        date: true,
        status: true,
        patient: { select: { id: true, fullName: true } },
        doctor: { select: { id: true, nameRu: true, nameUz: true } },
      },
      orderBy: { date: "asc" },
      take: MAX_RESULTS,
    });

    const data = rows.map((a) => ({
      appointmentId: a.id,
      patientName: a.patient?.fullName ?? "—",
      doctorName:
        context.locale === "uz" && a.doctor?.nameUz
          ? a.doctor.nameUz
          : a.doctor?.nameRu ?? "—",
      time: fmtTime(a.date),
      status: a.status,
      deeplink: `/crm/calendar?focus=${a.id}`,
    }));

    // Total today, irrespective of `take` cap, for the LLM summary line.
    const totalToday = await prisma.appointment.count({
      where: {
        clinicId: context.clinicId,
        date: { gte: today, lt: tomorrow },
        ...(input.doctorId ? { doctorId: input.doctorId } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });

    const summary =
      totalToday === 0
        ? context.locale === "ru"
          ? "На сегодня записей нет."
          : "Bugunga yozuvlar yo'q."
        : context.locale === "ru"
          ? `Сегодня ${totalToday} записей. Ближайшая: ${data[0]!.patientName} → ${data[0]!.doctorName} в ${data[0]!.time}.`
          : `Bugun ${totalToday} ta yozuv. Eng yaqini: ${data[0]!.patientName} → ${data[0]!.doctorName} soat ${data[0]!.time}.`;

    return {
      ok: true,
      data: { appointments: data, totalToday },
      summary,
      chips: data.slice(0, 5).map((a) => ({
        kind: "appointment" as const,
        label: `${a.time} · ${a.patientName}`,
        deeplink: a.deeplink,
      })),
    };
  },
};
