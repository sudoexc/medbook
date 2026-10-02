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
 * for a year when its drug is taken long term and for a month otherwise,
 * and a questionnaire for a month.
 */
import { drugInClass, type DrugClass, type RuleDrug } from "./interaction-rules";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An open-ended course («длительно») of a drug taken long term (epilepsy,
 * hypertension, anticoagulation, see LONG_TERM_THERAPY): the clinic never
 * closes them, and a year covers the usual interval between control visits
 * of a chronic patient.
 */
export const OPEN_COURSE_MAX_DAYS = 365;

/**
 * An open-ended course of any other drug. Every row the constructor adds
 * starts without a duration and the duration chips are optional, so most
 * of the clinic's short courses are open-ended too: a five-day ketorolac
 * signed in July, counted for a year, warned «уже принимает» against the
 * NSAID of the patient's next visit in October. A month covers the usual
 * neurology course (NSAIDs, B vitamins, nootropics, muscle relaxants).
 */
export const OPEN_SHORT_COURSE_DAYS = 30;

/** A questionnaire is filled for one visit, a few days before it. */
export const PREVISIT_MEDICATIONS_FRESH_DAYS = 30;

/**
 * Drugs taken for months or for life, whose open-ended course means
 * «длительно». WHO ATC index; the ids are catalog rows without an ATC code
 * (prisma/_drug-catalog-extra.ts), like the interaction rules' classes.
 * "levodopa-carbidopa" is the extension's copy of levodopa_carbidopa (audit
 * G4-21): it stays until scripts/fix-g4-21-duplicate-drugs.ts has moved the
 * courses picked from it to the curated row.
 */
export const LONG_TERM_THERAPY: DrugClass = {
  atc: [
    "A10", // drugs used in diabetes
    "B01AA", "B01AC", "B01AE", "B01AF", // VKA, antiplatelets, thrombin and Xa inhibitors
    "C01", // cardiac therapy: amiodarone, digoxin, nitrates, trimetazidine
    "C02", "C03", "C07", "C08", "C09", // antihypertensives, diuretics, beta blockers, CCB, RAAS
    "C10", // lipid modifying agents
    "G04CA", // alpha blockers for prostatic hyperplasia
    "H03", // thyroid therapy
    "M03BX01", // baclofen, for spasticity
    "M04AA", // allopurinol
    "N03", // antiepileptics, gabapentinoids included
    "N04", // anti-parkinson drugs
    "N05A", // antipsychotics, lithium
    "N06A", // antidepressants
    "N06D", // anti-dementia drugs
  ],
  ids: [
    "oxcarbazepine", "phenytoin", "clonazepam", "ethosuximide", "zonisamide", "lacosamide",
    "levodopa-carbidopa", "levodopa-benserazide", "amantadine", "trihexyphenidyl", "ropinirole",
    "rivastigmine", "galantamine",
    "fluoxetine", "paroxetine", "fluvoxamine", "mirtazapine", "trazodone", "agomelatine",
    "quetiapine", "risperidone", "olanzapine", "haloperidol", "chlorprothixene",
    "carvedilol", "verapamil", "diltiazem", "telmisartan", "irbesartan", "perindopril",
    "torasemide", "hydrochlorothiazide", "moxonidine", "ivabradine", "trimetazidine",
    "isosorbide-mononitrate", "digoxin", "apixaban", "dabigatran", "dipyridamole",
    "simvastatin", "fenofibrate", "ezetimibe",
    "glimepiride", "empagliflozin", "dapagliflozin", "vildagliptin",
    "insulin-glargine", "insulin-aspart",
  ],
};

/**
 * Is a drug taken long term? Pass every row it stands for (the row, its
 * same-substance twins, a combination's components): a register brand or a
 * combination counts like its substance.
 */
export function isLongTermTherapy(rows: readonly RuleDrug[]): boolean {
  return rows.some((r) => drugInClass(r, LONG_TERM_THERAPY));
}

export type CourseLike = {
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

/**
 * Is the patient still meant to be taking this course at `now`? `longTerm`
 * says whether its drug is taken long term (isLongTermTherapy), which sets
 * how long a course without a duration counts.
 */
export function isCourseCurrent(
  course: CourseLike,
  now: Date,
  longTerm: boolean,
): boolean {
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
  const openDays = longTerm ? OPEN_COURSE_MAX_DAYS : OPEN_SHORT_COURSE_DAYS;
  const end = start.getTime() + (days ?? openDays) * DAY_MS;
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
