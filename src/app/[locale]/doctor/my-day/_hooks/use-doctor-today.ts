"use client";

import { useQuery } from "@tanstack/react-query";

import { useLiveQueryInvalidation } from "@/hooks/use-live-query";
import type { AppointmentStatus } from "@/lib/appointment-transitions";

export type ScheduleType = "consultation" | "repeat" | "reserve" | "break";
export type ScheduleStatus =
  | "in_progress"
  | "upcoming"
  | "done"
  | "no_show"
  | "cancelled";

export type ScheduleEntry = {
  id: string;
  startTime: string;
  patientId: string | null;
  patientName: string | null;
  type: ScheduleType;
  durationMin: number | null;
  status: ScheduleStatus;
};

export type PatientTag = "active" | "first_visit" | "vip" | "new";

export type CurrentPatient = {
  appointmentId: string;
  patientId: string;
  /**
   * Raw appointment status — drives which CTA the card shows. WAITING →
   * «Начать приём», IN_PROGRESS → «Завершить приём», BOOKED → «Пациент
   * пришёл».
   */
  status: AppointmentStatus;
  fullName: string;
  age: number | null;
  birthDate: string | null;
  phone: string;
  avatarUrl: string | null;
  tags: PatientTag[];
  appointmentRange: string;
  startsAt: string;
  endsAt: string;
  startedAt: string | null;
  appointmentSecondsLeft: number;
  complaints: string;
  lastVisit: { date: string; title: string } | null;
  lastDiagnosis: { codes: { code: string; name: string }[] };
};

export type UpcomingPatient = {
  appointmentId: string;
  patientId: string;
  shortName: string;
  phone: string;
  startTime: string;
  /** Full ISO timestamp — needed for relative-time («через X») on the client. */
  startAt: string;
  durationMin: number;
  type: "consultation" | "repeat";
  avatarUrl: string | null;
};

export type ActionItem = {
  id: string;
  title: string;
  count: number;
  href: string;
};

export type ReminderItem = {
  id: string;
  title: string;
  /** Null when the reminder isn't bound to a patient (general task). */
  patientId: string | null;
  patientShort: string | null;
  remindAt: string;
  status: string;
};

export type UnreadResultItem = {
  id: string;
  testName: string;
  patientId: string;
  patientShort: string;
  receivedAt: string;
  flag: string | null;
  isNew: boolean;
};

export type DraftItem = {
  /** VisitNote id — opens at /doctor/conclusions/[id]. */
  id: string;
  title: string;
  patientId: string;
  patientShort: string;
  updatedAt: string;
};

export type RecentPatientItem = {
  id: string;
  shortName: string;
  lastVisitAt: string;
  avatarUrl: string | null;
};

export type DaySummary = {
  totalAppointments: number;
  consultations: number;
  repeats: number;
  completedCount: number;
  dayPlanPercent: number;
};

export type DoctorToday = {
  schedule: ScheduleEntry[];
  current: CurrentPatient | null;
  upcoming: UpcomingPatient[];
  upcomingTotal: number;
  daySummary: DaySummary;
  ai: { summary: string | null; alerts: unknown[]; recommendations: unknown[] };
  actionItems: ActionItem[];
  reminders: ReminderItem[];
  unreadResults: UnreadResultItem[];
  drafts: DraftItem[];
  recentPatients: RecentPatientItem[];
};

export const doctorTodayKey = ["doctor", "me", "today"] as const;

/**
 * Backs every card on /doctor/my-day via a single aggregate fetch.
 *
 * The `select` parameter lets each card subscribe to its own slice — TanStack
 * will only re-render the card whose slice actually changed. Without `select`
 * a status flip on any appointment would re-render all 10 cards in lockstep.
 *
 * SSE wiring covers every mutation that can change anything in the payload:
 *   - appointment.* → schedule / current / upcoming / recentPatients / daySummary
 *   - case.soap-draft.refreshed → drafts (visit-note DRAFT count surfaces here)
 *   - reminder.* → reminders + actionItems (due count)
 *   - lab.result.* → unreadResults + actionItems (unread count)
 *   - tg.message.new / tg.conversation.updated → actionItems (messages count)
 *
 * `useLiveQueryInvalidation` debounces with a 400ms coalesce inside, so a
 * burst of events fires at most one refetch.
 */
export function useDoctorToday<TSelected = DoctorToday>(
  select?: (data: DoctorToday) => TSelected,
) {
  const query = useQuery<DoctorToday, Error, TSelected>({
    queryKey: doctorTodayKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/today", {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error(`doctor-today: ${res.status}`);
      }
      return (await res.json()) as DoctorToday;
    },
    select,
    staleTime: 15_000,
  });

  useLiveQueryInvalidation({
    events: [
      "appointment.created",
      "appointment.updated",
      "appointment.statusChanged",
      "appointment.cancelled",
      "appointment.moved",
      "case.soap-draft.refreshed",
      "reminder.created",
      "reminder.updated",
      "lab.result.received",
      "lab.result.reviewed",
      "tg.message.new",
      "tg.conversation.updated",
    ],
    queryKey: doctorTodayKey,
  });

  return query;
}
