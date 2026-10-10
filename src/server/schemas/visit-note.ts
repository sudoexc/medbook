import { z } from "zod";

import { MAX_ADDITIONAL_DIAGNOSES } from "@/lib/visit-diagnoses";
import {
  FOLLOW_UP_MAX_DAYS,
  FOLLOW_UP_MIN_DAYS,
} from "@/lib/visit-follow-up";

export const VisitNoteStatusEnum = z.enum(["DRAFT", "FINALIZED"]);

const ChipArray = z.array(z.string().min(1).max(500)).max(40);

export const UpsertVisitNoteSchema = z.object({
  appointmentId: z.string().min(1),
});

// Ф2 (TZ-smart-constructor) — structured prescription rows.
export const MealRelationEnum = z.enum([
  "BEFORE_MEAL",
  "WITH_MEAL",
  "AFTER_MEAL",
  "EMPTY_STOMACH",
  "NO_MATTER",
]);

export const TimeOfDayEnum = z.enum(["MORNING", "NOON", "EVENING", "NIGHT"]);

export const VisitPrescriptionItemSchema = z
  .object({
    drugId: z.string().max(120).nullable().optional(),
    displayName: z.string().min(1).max(300),
    form: z.string().max(80).nullable().optional(),
    strength: z.string().max(80).nullable().optional(),
    dose: z.string().min(1).max(160),
    timesOfDay: z.array(TimeOfDayEnum).max(4).default([]),
    mealRelation: MealRelationEnum.default("NO_MATTER"),
    durationDays: z.number().int().min(1).max(365).nullable().optional(),
    // «Постоянно» (doctor's request 10.10.2026): taken with no end, for life.
    ongoing: z.boolean().default(false),
    instructionRu: z.string().max(2_000).nullable().optional(),
    instructionUz: z.string().max(2_000).nullable().optional(),
    remindPatient: z.boolean().default(true),
  })
  // A lifelong course has no day count. Both set is normalized, never
  // rejected: a 400 would roll back the doctor's replace-all autosave. The
  // database guards the same invariant with a CHECK.
  .transform((r) => (r.ongoing ? { ...r, durationDays: null } : r));

export type VisitPrescriptionItemInput = z.infer<
  typeof VisitPrescriptionItemSchema
>;

// Ф7 — динамика состояния относительно прошлого визита.
export const VisitDynamicsEnum = z.enum(["IMPROVED", "STABLE", "WORSE"]);

// Ф8 — карта тела. Координаты нормированы 0..1 относительно SVG-фигуры,
// view — какая проекция (спереди/сзади). Пустой массив = точек нет;
// клиент шлёт replace-all, как и visitPrescriptions.
export const BodyMapViewEnum = z.enum(["FRONT", "BACK"]);

export const BodyMapPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  view: BodyMapViewEnum,
  label: z.string().max(120).optional(),
});

export type BodyMapPointInput = z.infer<typeof BodyMapPointSchema>;

// One more diagnosis of the visit, held to the same limits as the main one
// (code ≤ 20, name ≤ 500). A null code is a diagnosis in the clinic's own
// words. Trimming, duplicates and order are settled by
// `normalizeNoteDiagnoses` in the route, not rejected here: an autosave that
// 400s loses the doctor's edit.
export const VisitDiagnosisSchema = z.object({
  code: z.string().trim().max(20).nullable().optional(),
  name: z.string().trim().min(1).max(500),
});

export const UpdateVisitNoteSchema = z.object({
  // Optimistic-concurrency token, not a data field. The client echoes the
  // `updatedAt` of the note revision it was editing; the PATCH route compares
  // it against the stored row and returns 409 `version_conflict` on mismatch,
  // so two windows editing the same note can never silently overwrite each
  // other. Optional for backward compatibility — callers that don't send it
  // keep the legacy last-write-wins behaviour.
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
  complaints: ChipArray.optional(),
  anamnesis: ChipArray.optional(),
  examination: ChipArray.optional(),
  prescriptions: ChipArray.optional(),
  advice: ChipArray.optional(),
  diagnosisCode: z.string().max(20).nullable().optional(),
  diagnosisName: z.string().max(500).nullable().optional(),
  // The diagnoses after the main one, in order; replace-all like
  // visitPrescriptions, an empty array clears them. See visit-diagnoses.ts.
  additionalDiagnoses: z
    .array(VisitDiagnosisSchema)
    .max(MAX_ADDITIONAL_DIAGNOSES)
    .optional(),
  bodyMarkdown: z.string().max(64_000).nullable().optional(),
  patientHandoutMarkdown: z.string().max(64_000).nullable().optional(),
  followUpDays: z
    .number()
    .int()
    .min(FOLLOW_UP_MIN_DAYS)
    .max(FOLLOW_UP_MAX_DAYS)
    .nullable()
    .optional(),
  // An exact control-visit day, YYYY-MM-DD (Tashkent). Only the shape is
  // checked here: whether it lies between tomorrow and a year ahead depends
  // on today, so the route decides that and answers with a reason the card
  // can put into words. Sent alone; the route derives followUpDays from it.
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  followUpNote: z.string().max(500).nullable().optional(),
  dynamics: VisitDynamicsEnum.nullable().optional(),
  dynamicsNote: z.string().max(500).nullable().optional(),
  bodyMap: z.array(BodyMapPointSchema).max(40).optional(),
  // Replace-all semantics, consistent with the autosave model: the editor
  // always sends the full current list (sortOrder = array index).
  visitPrescriptions: z.array(VisitPrescriptionItemSchema).max(30).optional(),
});

export const FinalizeVisitNoteSchema = z.object({}).optional();

export const QueryVisitNoteSchema = z.object({
  doctorId: z.string().optional(),
  patientId: z.string().optional(),
  status: VisitNoteStatusEnum.optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// Amendments (исправления) — append-only corrections to a finalized
// conclusion after the 24h edit window. Both fields are required: a
// correction without a stated reason is not defensible on paper.
export const CreateVisitNoteAmendmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(10_000),
});

export type CreateVisitNoteAmendmentInput = z.infer<
  typeof CreateVisitNoteAmendmentSchema
>;
