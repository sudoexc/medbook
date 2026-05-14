import { z } from "zod";

export const VisitNoteStatusEnum = z.enum(["DRAFT", "FINALIZED"]);

const ChipArray = z.array(z.string().min(1).max(500)).max(40);

export const UpsertVisitNoteSchema = z.object({
  appointmentId: z.string().min(1),
});

export const UpdateVisitNoteSchema = z.object({
  complaints: ChipArray.optional(),
  anamnesis: ChipArray.optional(),
  examination: ChipArray.optional(),
  prescriptions: ChipArray.optional(),
  advice: ChipArray.optional(),
  diagnosisCode: z.string().max(20).nullable().optional(),
  diagnosisName: z.string().max(500).nullable().optional(),
  bodyMarkdown: z.string().max(64_000).nullable().optional(),
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
