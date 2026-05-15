/**
 * GET /api/crm/doctors/me/today — one-shot aggregate that backs every card
 * on /doctor/my-day.
 *
 * Why one endpoint and not nine:
 *   /my-day mounts ten cards at once. Nine parallel `useQuery`s would mean
 *   nine fetches on every navigation in and out of the route, nine refetch
 *   timers on focus, and nine independent invalidations on every SSE event.
 *   This handler issues the queries in parallel via Promise.all and returns
 *   one payload — the cards consume slices via TanStack's `select`.
 *
 * No-AI-v1: the `ai` block (summary / alerts / recommendations) is reserved
 *   for a future worker. v1 returns `{summary: null, alerts: [], recommendations: []}`
 *   plus a numeric `daySummary` block of plain counts so the AI card still
 *   has something concrete to render (totalAppointments, repeats, completedCount).
 *
 * Tasks-card pragma: the schema's `Action` model is role-scoped, not user-
 *   scoped, so we can't filter `assigneeId = me`. Instead, `actionItems` is
 *   derived from real counters that *do* track per-doctor state — unread
 *   results, draft visit-notes, unread messages, due reminders — so the
 *   checklist mirrors actual outstanding work for this user.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";
import {
  scheduleStatusOf,
  type DoctorScheduleStatus,
} from "@/lib/doctor-schedule-status";
import type { AppointmentStatus } from "@/lib/appointment-transitions";

const REPEAT_VISITS_THRESHOLD = 2;
const RECENT_PATIENTS_WINDOW_DAYS = 14;

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
};

type PatientTag = "active" | "first_visit" | "vip" | "new";

type CurrentPatient = {
  appointmentId: string;
  patientId: string;
  /**
   * Raw appointment status — the doctor surface picks the primary CTA off
   * this. `current` is surfaced for BOOKED-imminent / WAITING / IN_PROGRESS;
   * the UI branches accordingly so each state has a distinct primary action.
   */
  status: AppointmentStatus;
  fullName: string;
  age: number | null;
  birthDate: string | null;
  phone: string;
  avatarUrl: string | null;
  tags: PatientTag[];
  appointmentRange: string;
  /** Scheduled start (ISO). Frontend computes "через X мин" before start. */
  startsAt: string;
  /** Scheduled end (ISO). Backstop for the slot-end timer. */
  endsAt: string;
  /** When the doctor flipped to IN_PROGRESS. Null until then. */
  startedAt: string | null;
  appointmentSecondsLeft: number;
  complaints: string;
  lastVisit: { date: string; title: string } | null;
  lastDiagnosis: { codes: { code: string; name: string }[] };
};

type UpcomingPatient = {
  appointmentId: string;
  patientId: string;
  shortName: string;
  phone: string;
  startTime: string;
  startAt: string;
  durationMin: number;
  type: "consultation" | "repeat";
  avatarUrl: string | null;
};

type ActionItem = { id: string; title: string; count: number; href: string };

type ReminderItem = {
  id: string;
  title: string;
  /** Null when the reminder isn't bound to a patient (general task). */
  patientId: string | null;
  patientShort: string | null;
  remindAt: string;
  status: string;
};

type UnreadResultItem = {
  id: string;
  testName: string;
  /** Deep-link target so a click on the row opens the patient's labs tab. */
  patientId: string;
  patientShort: string;
  receivedAt: string;
  flag: string | null;
  isNew: boolean;
};

type DraftItem = {
  /** VisitNote id — used to deep-link «Продолжить» to /doctor/conclusions/[id]. */
  id: string;
  title: string;
  patientId: string;
  patientShort: string;
  updatedAt: string;
};

type RecentPatientItem = {
  id: string;
  shortName: string;
  lastVisitAt: string;
  avatarUrl: string | null;
};

type DaySummary = {
  totalAppointments: number;
  consultations: number;
  repeats: number;
  completedCount: number;
  dayPlanPercent: number;
};

type TodayResponse = {
  schedule: ScheduleEntry[];
  current: CurrentPatient | null;
  upcoming: UpcomingPatient[];
  /**
   * Total upcoming appointments today, regardless of how many the
   * `upcoming` array carries — used by the «Показать всех (N)» footer
   * so the count is honest even when we slice the list at 5.
   */
  upcomingTotal: number;
  daySummary: DaySummary;
  ai: { summary: null; alerts: []; recommendations: [] };
  actionItems: ActionItem[];
  reminders: ReminderItem[];
  unreadResults: UnreadResultItem[];
  drafts: DraftItem[];
  recentPatients: RecentPatientItem[];
};

function startOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatHHMM(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function shortName(fullName: string): string {
  // "Турсунова Феруза Камиловна" → "Турсунова Ф.К."
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName.trim();
  const surname = parts[0];
  const initials = parts
    .slice(1, 3)
    .map((p) => `${p.charAt(0)}.`)
    .join("");
  return `${surname} ${initials}`;
}

function ageFromBirthDate(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

function derivePatientTags(p: {
  visitsCount: number;
  tags: string[];
  segment: string;
  lastVisitAt: Date | null;
}): PatientTag[] {
  const out: PatientTag[] = [];
  // "vip" is a clinic-driven label stored explicitly.
  if (p.tags?.includes("vip")) out.push("vip");
  // "new" — segment from Phase 14 patient experience work.
  if (p.segment === "NEW") out.push("new");
  // "first_visit" — never been here, or just once.
  if (p.visitsCount <= 1) out.push("first_visit");
  // "active" — has visited in the last 90 days. Mutually-informative with
  // "new", we keep both — the UI picks how to render.
  if (p.lastVisitAt) {
    const days =
      (Date.now() - p.lastVisitAt.getTime()) / (1000 * 60 * 60 * 24);
    if (days <= 90) out.push("active");
  }
  return out;
}

function appointmentTypeOf(visitsCount: number): "consultation" | "repeat" {
  return visitsCount >= REPEAT_VISITS_THRESHOLD ? "repeat" : "consultation";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, userId: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, { reason: "no_doctor_row" });
    }

    const now = new Date();
    const dayStart = startOfLocalDay(now);
    const dayEnd = endOfLocalDay(now);
    const reminderHorizon = new Date(now);
    reminderHorizon.setHours(reminderHorizon.getHours() + 24);
    const recentWindowStart = new Date(now);
    recentWindowStart.setDate(
      recentWindowStart.getDate() - RECENT_PATIENTS_WINDOW_DAYS,
    );

    // ──────────────────────────────────────────────────────────────────────
    // Run all independent queries in parallel. The branches are ordered to
    // make the destructure below readable, not by cost.
    // ──────────────────────────────────────────────────────────────────────
    const [
      todayAppts,
      activeReminders,
      unreadLabs,
      draftNotes,
      recentApptsRaw,
      unreadMsgAgg,
      counts,
    ] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          date: { gte: dayStart, lte: dayEnd },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          date: true,
          endDate: true,
          time: true,
          durationMin: true,
          status: true,
          startedAt: true,
          patientId: true,
          patient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              birthDate: true,
              photoUrl: true,
              visitsCount: true,
              tags: true,
              segment: true,
              lastVisitAt: true,
              notes: true,
            },
          },
        },
      }),
      prisma.reminder.findMany({
        where: {
          doctorId: ctx.userId,
          status: { in: ["PENDING", "SNOOZED"] },
          remindAt: { lte: reminderHorizon },
        },
        orderBy: [{ remindAt: "asc" }, { id: "asc" }],
        take: 5,
        select: {
          id: true,
          title: true,
          remindAt: true,
          status: true,
          patient: { select: { id: true, fullName: true } },
        },
      }),
      prisma.labResult.findMany({
        where: { doctorId: ctx.userId, status: "RESULTED" },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 5,
        select: {
          id: true,
          testName: true,
          flag: true,
          receivedAt: true,
          patient: { select: { id: true, fullName: true } },
        },
      }),
      prisma.visitNote.findMany({
        where: { doctorId: doctor.id, status: "DRAFT" },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: 5,
        select: {
          id: true,
          startedAt: true,
          appointment: {
            select: { date: true },
          },
          patient: { select: { id: true, fullName: true } },
        },
      }),
      // "Recent" = COMPLETED visits in the last 14d, distinct on patientId.
      // We over-fetch and de-dupe in JS — DISTINCT-on-related-column is
      // awkward in Prisma without raw SQL.
      prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          status: "COMPLETED",
          date: { gte: recentWindowStart, lt: dayStart },
        },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 30,
        select: {
          patientId: true,
          date: true,
          patient: {
            select: { id: true, fullName: true, photoUrl: true },
          },
        },
      }),
      prisma.conversation.aggregate({
        where: {
          unreadCount: { gt: 0 },
          OR: [
            { appointment: { doctorId: doctor.id } },
            { assignedToId: doctor.userId ?? "__never__" },
          ],
        },
        _sum: { unreadCount: true },
      }),
      // Total counters for "actionItems" badges. Same predicates as the
      // list queries above so the badge matches the list length.
      Promise.all([
        prisma.labResult.count({
          where: { doctorId: ctx.userId, status: "RESULTED" },
        }),
        prisma.visitNote.count({
          where: { doctorId: doctor.id, status: "DRAFT" },
        }),
        prisma.reminder.count({
          where: {
            doctorId: ctx.userId,
            status: { in: ["PENDING", "SNOOZED"] },
            remindAt: { lte: reminderHorizon },
          },
        }),
      ]),
    ]);

    const [unreadLabsCount, draftCount, dueRemindersCount] = counts;
    const unreadMessages = unreadMsgAgg._sum.unreadCount ?? 0;

    // ──────────────────────────────────────────────────────────────────────
    // schedule + summary (always-on numbers)
    // ──────────────────────────────────────────────────────────────────────
    const schedule: ScheduleEntry[] = todayAppts.map((a) => ({
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
    for (const a of todayAppts) {
      if (a.status === "CANCELLED") continue;
      if (a.status === "COMPLETED") completedCount += 1;
      const t = appointmentTypeOf(a.patient?.visitsCount ?? 0);
      if (t === "repeat") repeats += 1;
      else consultations += 1;
    }
    const totalAppointments = todayAppts.filter(
      (a) => a.status !== "CANCELLED",
    ).length;
    const dayPlanPercent =
      totalAppointments > 0
        ? Math.round((completedCount / totalAppointments) * 100)
        : 0;
    const daySummary: DaySummary = {
      totalAppointments,
      consultations,
      repeats,
      completedCount,
      dayPlanPercent,
    };

    // ──────────────────────────────────────────────────────────────────────
    // current — IN_PROGRESS appointment for this doctor (at most one in
    // practice — the queue UI enforces single-in-progress). Falls back to
    // the next upcoming appointment within 15 minutes if nothing is active.
    // ──────────────────────────────────────────────────────────────────────
    const inProgress = todayAppts.find(
      (a) => a.status === "IN_PROGRESS" || a.status === "WAITING",
    );
    let currentSource: (typeof todayAppts)[number] | undefined = inProgress;
    if (!currentSource) {
      const upcomingSoon = todayAppts.find((a) => {
        const ms = a.date.getTime() - now.getTime();
        return a.status === "BOOKED" && ms >= 0 && ms <= 15 * 60_000;
      });
      currentSource = upcomingSoon;
    }

    let current: CurrentPatient | null = null;
    if (currentSource && currentSource.patient) {
      const p = currentSource.patient;
      const endAt = new Date(
        currentSource.date.getTime() + currentSource.durationMin * 60_000,
      );
      const range = `${formatHHMM(currentSource.date)} — ${formatHHMM(endAt)}`;
      const secondsLeft = Math.max(
        0,
        Math.floor((endAt.getTime() - now.getTime()) / 1000),
      );

      const lastVisit = await prisma.appointment.findFirst({
        where: {
          patientId: p.id,
          doctorId: doctor.id,
          status: "COMPLETED",
          id: { not: currentSource.id },
        },
        orderBy: [{ date: "desc" }],
        select: {
          date: true,
          primaryService: { select: { nameRu: true } },
          visitNote: {
            select: { diagnosisCode: true, diagnosisName: true },
          },
        },
      });

      current = {
        appointmentId: currentSource.id,
        patientId: p.id,
        status: currentSource.status as AppointmentStatus,
        fullName: p.fullName,
        age: ageFromBirthDate(p.birthDate),
        birthDate: p.birthDate ? p.birthDate.toISOString() : null,
        phone: p.phone,
        avatarUrl: p.photoUrl,
        tags: derivePatientTags({
          visitsCount: p.visitsCount,
          tags: p.tags ?? [],
          segment: p.segment,
          lastVisitAt: p.lastVisitAt,
        }),
        appointmentRange: range,
        startsAt: currentSource.date.toISOString(),
        endsAt: endAt.toISOString(),
        startedAt: currentSource.startedAt
          ? currentSource.startedAt.toISOString()
          : null,
        appointmentSecondsLeft: secondsLeft,
        // Patient.notes is the closest analogue we have to "complaints"
        // without dragging in the whole VisitNote.complaints[] array. v2
        // can pull the active visit's complaints when the reception flow
        // starts writing them in real-time.
        complaints: p.notes?.trim() ?? "",
        lastVisit: lastVisit
          ? {
              date: lastVisit.date.toISOString(),
              title:
                lastVisit.primaryService?.nameRu ?? "Приём",
            }
          : null,
        lastDiagnosis: {
          codes:
            lastVisit?.visitNote?.diagnosisCode && lastVisit.visitNote.diagnosisName
              ? [
                  {
                    code: lastVisit.visitNote.diagnosisCode,
                    name: lastVisit.visitNote.diagnosisName,
                  },
                ]
              : [],
        },
      };
    }

    // ──────────────────────────────────────────────────────────────────────
    // upcoming — next 5 actionable today (not current, not cancelled, not
    // done), excluding whichever appointment is currentSource.
    // upcomingTotal counts the *whole* upcoming queue so the «Показать
    // всех (N)» footer doesn't lie about how many we're hiding.
    // ──────────────────────────────────────────────────────────────────────
    const upcomingAll = todayAppts.filter((a) => {
      if (currentSource && a.id === currentSource.id) return false;
      const s = scheduleStatusOf(a.status);
      return s === "upcoming";
    });
    const upcoming: UpcomingPatient[] = upcomingAll.slice(0, 5).map((a) => ({
      appointmentId: a.id,
      patientId: a.patientId,
      shortName: a.patient ? shortName(a.patient.fullName) : "—",
      phone: a.patient?.phone ?? "",
      startTime: a.time ?? formatHHMM(a.date),
      startAt: a.date.toISOString(),
      durationMin: a.durationMin,
      type: appointmentTypeOf(a.patient?.visitsCount ?? 0),
      avatarUrl: a.patient?.photoUrl ?? null,
    }));
    const upcomingTotal = upcomingAll.length;

    // ──────────────────────────────────────────────────────────────────────
    // actionItems — derived counts. Order matters: this is the order the
    // card renders. Each entry has a stable id so React keys are stable
    // across renders.
    // ──────────────────────────────────────────────────────────────────────
    const actionItems: ActionItem[] = [
      {
        id: "unread-results",
        title: "Просмотреть результаты анализов",
        count: unreadLabsCount,
        href: "/doctor/conclusions?tab=labs",
      },
      {
        id: "drafts",
        title: "Подписать черновики заключений",
        count: draftCount,
        href: "/doctor/conclusions?status=draft",
      },
      {
        id: "messages",
        title: "Ответить на сообщения",
        count: unreadMessages,
        href: "/doctor/messages",
      },
      {
        id: "reminders",
        title: "Активные напоминания",
        count: dueRemindersCount,
        href: "/doctor/my-day",
      },
    ];

    const reminders: ReminderItem[] = activeReminders.map((r) => ({
      id: r.id,
      title: r.title,
      patientId: r.patient?.id ?? null,
      patientShort: r.patient ? shortName(r.patient.fullName) : null,
      remindAt: r.remindAt.toISOString(),
      status: r.status,
    }));

    const unreadResults: UnreadResultItem[] = unreadLabs
      .filter((r) => r.patient)
      .map((r) => ({
        id: r.id,
        testName: r.testName,
        patientId: r.patient!.id,
        patientShort: shortName(r.patient!.fullName),
        receivedAt: r.receivedAt.toISOString(),
        flag: r.flag,
        // "new" badge — received within the last 24h.
        isNew: now.getTime() - r.receivedAt.getTime() <= 24 * 60 * 60_000,
      }));

    const drafts: DraftItem[] = draftNotes
      .filter((d) => d.patient)
      .map((d) => {
        const appointmentDate = d.appointment?.date ?? d.startedAt ?? now;
        return {
          id: d.id,
          title: `Заключение от ${appointmentDate.toISOString().slice(0, 10)}`,
          patientId: d.patient!.id,
          patientShort: shortName(d.patient!.fullName),
          updatedAt: (d.startedAt ?? appointmentDate).toISOString(),
        };
      });

    // De-dupe completed visits by patientId, keep first (most recent) hit.
    const seen = new Set<string>();
    const recentPatients: RecentPatientItem[] = [];
    for (const a of recentApptsRaw) {
      if (!a.patient) continue;
      if (seen.has(a.patient.id)) continue;
      seen.add(a.patient.id);
      recentPatients.push({
        id: a.patient.id,
        shortName: shortName(a.patient.fullName),
        lastVisitAt: a.date.toISOString(),
        avatarUrl: a.patient.photoUrl,
      });
      if (recentPatients.length >= 5) break;
    }

    const payload: TodayResponse = {
      schedule,
      current,
      upcoming,
      upcomingTotal,
      daySummary,
      ai: { summary: null, alerts: [], recommendations: [] },
      actionItems,
      reminders,
      unreadResults,
      drafts,
      recentPatients,
    };
    return ok(payload);
  },
);
