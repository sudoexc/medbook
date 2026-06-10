import { z } from "zod";

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

export const VisitPrescriptionItemSchema = z.object({
  drugId: z.string().max(120).nullable().optional(),
  displayName: z.string().min(1).max(300),
  form: z.string().max(80).nullable().optional(),
  strength: z.string().max(80).nullable().optional(),
  dose: z.string().min(1).max(160),
  timesOfDay: z.array(TimeOfDayEnum).max(4).default([]),
  mealRelation: MealRelationEnum.default("NO_MATTER"),
  durationDays: z.number().int().min(1).max(365).nullable().optional(),
  instructionRu: z.string().max(2_000).nullable().optional(),
  instructionUz: z.string().max(2_000).nullable().optional(),
  remindPatient: z.boolean().default(true),
});

export type VisitPrescriptionItemInput = z.infer<
  typeof VisitPrescriptionItemSchema
>;

// Ф7 — динамика состояния относительно прошлого визита.
export const VisitDynamicsEnum = z.enum(["IMPROVED", "STABLE", "WORSE"]);

export const UpdateVisitNoteSchema = z.object({
  complaints: ChipArray.optional(),
  anamnesis: ChipArray.optional(),
  examination: ChipArray.optional(),
  prescriptions: ChipArray.optional(),
  advice: ChipArray.optional(),
  diagnosisCode: z.string().max(20).nullable().optional(),
  diagnosisName: z.string().max(500).nullable().optional(),
  bodyMarkdown: z.string().max(64_000).nullable().optional(),
  patientHandoutMarkdown: z.string().max(64_000).nullable().optional(),
  followUpDays: z.number().int().min(1).max(365).nullable().optional(),
  followUpNote: z.string().max(500).nullable().optional(),
  dynamics: VisitDynamicsEnum.nullable().optional(),
  dynamicsNote: z.string().max(500).nullable().optional(),
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
