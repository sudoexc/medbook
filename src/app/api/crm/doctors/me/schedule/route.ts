/**
 * GET /api/crm/doctors/me/schedule?date=YYYY-MM-DD
 *
 * Date-parametrized slice of the doctor's day plan, used by:
 *   - the schedule card on /doctor/my-day (when the doctor pages back/
 *     forward through dates with ← / → / «Сегодня»);
 *   - the full-screen agenda at /doctor/schedule.
 *
 * The /today aggregate stays as-is — it serves the *current* day's
 * dashboard (current patient, upcoming, drafts, reminders, etc.) and
 * isn't meaningful for past or future dates. This endpoint is the
 * narrower "just the schedule + day summary, for any date" query.
 *
 * `date` is the calling browser's local YYYY-MM-DD; missing → today
 * (server local). The day window is [00:00, 23:59:59.999] in server
 * local time, matching how appointments are persisted.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err, parseQuery } from "@/server/http";

const REPEAT_VISITS_THRESHOLD = 2;

type ScheduleType = "consultation" | "repeat" | "reserve" | "break";
type ScheduleStatus = "in_progress" | "upcoming" | "done" | "cancelled";

type ScheduleEntry = {
  id: string;
  startTime: string;
  patientId: string | null;
  patientName: string | null;
  type: ScheduleType;
  durationMin: number | null;
  status: ScheduleStatus;
};

type DaySummary = {
  totalAppointments: number;
  consultations: number;
  repeats: number;
  completedCount: number;
  dayPlanPercent: number;
};

const Query = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
});

function dayWindow(dateStr: string | undefined): { start: Date; end: Date; iso: string } {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return { start, end, iso: `${y}-${m}-${d}` };
}

function formatHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function appointmentTypeOf(visitsCount: number): "consultation" | "repeat" {
  return visitsCount >= REPEAT_VISITS_THRESHOLD ? "repeat" : "consultation";
}

function scheduleStatusOf(status: string): ScheduleStatus {
  if (status === "IN_PROGRESS" || status === "WAITING") return "in_progress";
  if (status === "COMPLETED" || status === "NO_SHOW" || status === "SKIPPED")
    return "done";
  if (status === "CANCELLED") return "cancelled";
  return "upcoming";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const parsed = parseQuery(request, Query);
    if (!parsed.ok) return parsed.response;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, { reason: "no_doctor_row" });
    }

    const { start, end, iso } = dayWindow(parsed.value.date);

    const appts = await prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        date: { gte: start, lte: end },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        date: true,
        time: true,
        durationMin: true,
        status: true,
        patientId: true,
        patient: {
          select: {
            fullName: true,
            visitsCount: true,
          },
        },
      },
    });

    const entries: ScheduleEntry[] = appts.map((a) => ({
      id: a.id,
      startTime: a.time ?? formatHHMM(a.date),
      patientId: a.patientId,
      patientName: a.patient?.fullName ?? null,
      type: appointmentTypeOf(a.patient?.visitsCount ?? 0),
      durationMin: a.durationMin,
      status: scheduleStatusOf(a.status),
    }));

    let consultations = 0;
    let repeats = 0;
    let completedCount = 0;
    for (const a of appts) {
      if (a.status === "CANCELLED") continue;
      if (a.status === "COMPLETED") completedCount += 1;
      const t = appointmentTypeOf(a.patient?.visitsCount ?? 0);
      if (t === "repeat") repeats += 1;
      else consultations += 1;
    }
    const totalAppointments = appts.filter(
      (a) => a.status !== "CANCELLED",
    ).length;
    const summary: DaySummary = {
      totalAppointments,
      consultations,
      repeats,
      completedCount,
      dayPlanPercent:
        totalAppointments > 0
          ? Math.round((completedCount / totalAppointments) * 100)
          : 0,
    };

    return ok({ date: iso, entries, summary });
  },
);
