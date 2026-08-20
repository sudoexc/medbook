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
 * `date` is a YYYY-MM-DD string interpreted as a **Tashkent** calendar day
 * (clinic time, UTC+5, no DST); missing → today in Tashkent. The day
 * window is [00:00, 24:00) Tashkent — NOT server-local: prod runs UTC and
 * `setHours(0,0,0,0)` there would shift the day by 5 hours vs. the clinic.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  tashkentComponents,
} from "@/lib/booking-validation";
import {
  scheduleStatusOf,
  type DoctorScheduleStatus,
} from "@/lib/doctor-schedule-status";
import type { AppointmentStatus } from "@/lib/appointment-transitions";
import { ok, err, parseQuery } from "@/server/http";

const REPEAT_VISITS_THRESHOLD = 2;

type ScheduleType = "consultation" | "repeat" | "reserve" | "break";
type ScheduleStatus = DoctorScheduleStatus;

type ScheduleEntry = {
  id: string;
  startTime: string;
  patientId: string | null;
  patientName: string | null;
  type: ScheduleType;
  durationMin: number | null;
  status: ScheduleStatus;
  /**
   * Raw Appointment.status. The UI-facing `status` above collapses
   * COMPLETED and SKIPPED into one "done" bucket, but their revert targets
   * differ (IN_PROGRESS vs WAITING) — the row's undo button needs the raw
   * value to ask `revertTargetFor` instead of guessing.
   */
  appointmentStatus: AppointmentStatus;
  /**
   * When the doctor pressed "Вызвать пациента". The schedule UI uses this
   * to flip the row CTA from "Вызвать" to "Начать приём" without needing
   * a separate enum status. Null when the patient has not been called yet.
   */
  calledAt: string | null;
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

/**
 * Resolve `[start, end)` for the requested Tashkent calendar day.
 * `iso` echoes the day back to the client in clinic time.
 */
function dayWindow(dateStr: string | undefined): { start: Date; end: Date; iso: string } {
  if (dateStr) {
    const { dayStart, dayEnd } = tashkentDayBoundsForDateString(dateStr);
    return { start: dayStart, end: dayEnd, iso: dateStr };
  }
  const now = new Date();
  const { dayStart, dayEnd } = tashkentDayBounds(now);
  return { start: dayStart, end: dayEnd, iso: tashkentComponents(now).date };
}

/** "HH:MM" in Tashkent wall clock — fallback when `Appointment.time` is empty. */
function formatHHMM(d: Date): string {
  return tashkentComponents(d).time;
}

function appointmentTypeOf(visitsCount: number): "consultation" | "repeat" {
  return visitsCount >= REPEAT_VISITS_THRESHOLD ? "repeat" : "consultation";
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
        date: { gte: start, lt: end },
        // Two-lanes: walk-ins live only in the «Живая очередь» lane, never in
        // the time-grid schedule — otherwise they double up (once here, once
        // in the live queue) and clutter the day plan.
        NOT: { channel: "WALKIN" },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        date: true,
        time: true,
        durationMin: true,
        status: true,
        calledAt: true,
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
      appointmentStatus: a.status as AppointmentStatus,
      calledAt: a.calledAt ? a.calledAt.toISOString() : null,
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

    // `doctorId` lets the client-side SSE filter drop events addressed to
    // other doctors of the clinic (see `useDoctorSchedule`).
    return ok({ date: iso, doctorId: doctor.id, entries, summary });
  },
);
