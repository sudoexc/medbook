/**
 * The patient's current therapy, for the CDS engine (audit G4-03).
 *
 * The check used to see only the prescriptions of the visit on screen. The
 * most dangerous interactions are between a new drug and one the patient
 * already takes: warfarin from a previous visit and ketorolac today came
 * back green. Two sources now count as current therapy:
 *   - the patient's ACTIVE medication courses (`Prescription`, bridged from
 *     signed visits or written in a case), while the course runs;
 *   - the medicines the patient listed in the pre-visit questionnaire, while
 *     it is recent enough to describe this visit.
 *
 * Neither source ends by itself: nothing moves a finished course out of
 * ACTIVE, and a questionnaire from last year says nothing about today. So a
 * course with a duration counts until its last day, one without a duration
 * for a year from its start, and a questionnaire for a month.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An open-ended course («длительно») is usual for epilepsy, hypertension or
 * anticoagulation, but the clinic never closes them. A year covers the
 * usual interval between control visits of a chronic patient.
 */
export const OPEN_COURSE_MAX_DAYS = 365;

/** A questionnaire is filled for one visit, a few days before it. */
export const PREVISIT_MEDICATIONS_FRESH_DAYS = 30;

type CourseLike = {
  status: string;
  schedule: unknown;
  createdAt: Date;
};

/** When the course started: its schedule's `startsAt`, else its creation. */
export function courseStart(course: CourseLike): Date {
  const raw =
    course.schedule && typeof course.schedule === "object"
      ? (course.schedule as { startsAt?: unknown }).startsAt
      : null;
  const d = typeof raw === "string" ? new Date(raw) : null;
  return d && Number.isFinite(d.getTime()) ? d : course.createdAt;
}

/** Is the patient still meant to be taking this course at `now`? */
export function isCourseCurrent(course: CourseLike, now: Date): boolean {
  if (course.status !== "ACTIVE") return false;
  const start = courseStart(course);
  const rawDays =
    course.schedule && typeof course.schedule === "object"
      ? (course.schedule as { days?: unknown }).days
      : null;
  const days =
    typeof rawDays === "number" && Number.isFinite(rawDays) && rawDays > 0
      ? Math.floor(rawDays)
      : null;
  // A course set to start later is planned therapy: it counts.
  if (start.getTime() > now.getTime()) return true;
  const end =
    start.getTime() + (days ?? OPEN_COURSE_MAX_DAYS) * DAY_MS;
  return now.getTime() < end;
}

/** Is a questionnaire sent at `submittedAt` still about this visit? */
export function isQuestionnaireFresh(
  submittedAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!submittedAt) return false;
  return now.getTime() - submittedAt.getTime() <= PREVISIT_MEDICATIONS_FRESH_DAYS * DAY_MS;
}
