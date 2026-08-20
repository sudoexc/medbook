/**
 * GET /api/crm/doctors/me/today — the /doctor/my-day dashboard aggregate.
 *
 * Scope note: this used to be a ten-block payload (schedule, upcoming,
 * daySummary, reminders, drafts, unread labs/messages, recent patients, ai)
 * backed by ~8 parallel DB queries. After the screen was simplified the
 * client reads exactly three things — `current`, `currentIsImplicitNext`
 * and `liveQueue` (see my-day/_components/*, which select slices via
 * `useDoctorToday<T>(selector)`); the ScheduleCard fetches its own data
 * from /doctors/me/schedule. Every dead block was dropped TOGETHER WITH its
 * queries — this endpoint refetches on every appointment/queue SSE event
 * for every doctor, so each spare query here was multiplied by clinic-wide
 * event traffic.
 *
 * `doctorId` rides on the payload so the client SSE filter can drop events
 * addressed to other doctors (see `useDoctorToday`).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { ok, err } from "@/server/http";
import { pickCurrentVisit } from "@/lib/doctor-current-visit";
import type { AppointmentStatus } from "@/lib/appointment-transitions";

type PatientTag = "active" | "first_visit" | "vip" | "new";

type CurrentPatient = {
  appointmentId: string;
  patientId: string;
  /**
   * Raw appointment status — the doctor surface picks the primary CTA off
   * this. `current` is surfaced for BOOKED/CONFIRMED-imminent / WAITING / IN_PROGRESS;
   * the UI branches accordingly so each state has a distinct primary action.
   */
  status: AppointmentStatus;
  fullName: string;
  age: number | null;
  birthDate: string | null;
  phone: string;
  avatarUrl: string | null;
  tags: PatientTag[];
  /** Scheduled start (ISO). Frontend computes "через X мин" before start. */
  startsAt: string;
  /** Scheduled end (ISO). Backstop for the slot-end timer. */
  endsAt: string;
  /** When the doctor flipped to IN_PROGRESS. Null until then. */
  startedAt: string | null;
  /**
   * When the doctor pressed "Вызвать пациента". Drives the 3-step flow
   * on the current-patient card: !calledAt → primary CTA "Вызвать",
   * calledAt && WAITING → primary CTA "Начать приём" (with a "Вызван
   * N сек назад" badge).
   */
  calledAt: string | null;
  appointmentSecondsLeft: number;
  complaints: string;
  lastVisit: { date: string; title: string } | null;
  lastDiagnosis: { codes: { code: string; name: string }[] };
};

/**
 * One row of the LIVE lane (walk-ins only — docs/TZ-two-lanes.md). Full
 * names are fine here: this is the doctor's own authenticated surface,
 * unlike the public TV/kiosk projections which reduce to initials.
 */
type LiveQueueEntry = {
  appointmentId: string;
  patientFullName: string;
  ticketNumber: string;
  /** 1-based FIFO position within the live lane. */
  position: number;
  etaMinutes: number;
  /** ISO — when the patient joined the queue. Omitted for legacy rows. */
  queuedAt?: string;
};

type TodayResponse = {
  /** Doctor row id — the client filters SSE events on it (my-day hooks). */
  doctorId: string;
  current: CurrentPatient | null;
  /**
   * True when `current` is the imminent-booking fallback (next BOOKED/
   * CONFIRMED within 15 min), not a real IN_PROGRESS/WAITING visit — the
   * client labels it «Следующая запись» instead of pretending the doctor
   * already picked this patient.
   */
  currentIsImplicitNext: boolean;
  /**
   * The LIVE lane (walk-in FIFO) from the canonical queue projection —
   * rendered as its own card next to the schedule so the doctor explicitly
   * picks whom to serve. Bookings never appear here (two-lanes model).
   */
  liveQueue: LiveQueueEntry[];
};

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

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, { reason: "no_doctor_row" });
    }

    const now = new Date();
    const { dayStart, dayEnd } = tashkentDayBounds(now);

    const [todayAppts, queueProjection] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          date: { gte: dayStart, lt: dayEnd },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          date: true,
          durationMin: true,
          status: true,
          startedAt: true,
          calledAt: true,
          // Two-lanes: pickCurrentVisit uses the channel to keep walk-ins out
          // of the imminent-booking fallback.
          channel: true,
          // Two-lanes: only used as the "ждёт с …" label source for the
          // liveQueue block below — never as an ordering key here.
          queuedAt: true,
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
      // Canonical live-lane projection (same source as TV/kiosk/ticket) —
      // one doctor, so the Map carries at most one entry.
      getQueueProjection({ clinicId: ctx.clinicId, doctorIds: [doctor.id] }),
    ]);

    // ──────────────────────────────────────────────────────────────────────
    // current — IN_PROGRESS appointment for this doctor (at most one in
    // practice — the queue UI enforces single-in-progress). Falls back to
    // the next upcoming appointment within 15 minutes if nothing is active.
    // ──────────────────────────────────────────────────────────────────────
    // Precedence + the shadowing bug it fixes live in `pickCurrentVisit`
    // (unit-tested in tests/unit/doctor-current-visit.test.ts).
    const picked = pickCurrentVisit(todayAppts, now);
    const currentSource: (typeof todayAppts)[number] | undefined = picked?.row;

    let current: CurrentPatient | null = null;
    if (currentSource && currentSource.patient) {
      const p = currentSource.patient;
      const endAt = new Date(
        currentSource.date.getTime() + currentSource.durationMin * 60_000,
      );
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
        startsAt: currentSource.date.toISOString(),
        endsAt: endAt.toISOString(),
        startedAt: currentSource.startedAt
          ? currentSource.startedAt.toISOString()
          : null,
        calledAt: currentSource.calledAt
          ? currentSource.calledAt.toISOString()
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

    // `current` above may be the imminent-booking fallback — presentation
    // sugar, not a doctor's pick. Flag it so the client can label the card
    // «Следующая запись» instead of implying a visit is underway.
    const currentIsImplicitNext = current !== null && picked?.isImplicitNext === true;

    // ──────────────────────────────────────────────────────────────────────
    // liveQueue — the walk-in FIFO from the shared projection. `queuedAt`
    // is joined back from todayAppts (the projection doesn't carry it);
    // rows that predate queuedAt simply omit the "ждёт N мин" label.
    // ──────────────────────────────────────────────────────────────────────
    const queuedAtById = new Map(
      todayAppts.map((a) => [a.id, a.queuedAt] as const),
    );
    const liveQueue: LiveQueueEntry[] = (
      queueProjection.get(doctor.id)?.waiting ?? []
    ).map((w) => {
      const queuedAt = queuedAtById.get(w.appointmentId);
      return {
        appointmentId: w.appointmentId,
        patientFullName: w.patientFullName,
        ticketNumber: w.ticketNumber,
        position: w.position,
        etaMinutes: w.etaMinutes,
        ...(queuedAt ? { queuedAt: queuedAt.toISOString() } : {}),
      };
    });

    const payload: TodayResponse = {
      doctorId: doctor.id,
      current,
      currentIsImplicitNext,
      liveQueue,
    };
    return ok(payload);
  },
);
