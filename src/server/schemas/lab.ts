import { z } from "zod";

export const QueryLabCatalogSchema = z.object({
  q: z.string().trim().optional(),
  biomaterial: z
    .enum([
      "BLOOD",
      "SERUM",
      "PLASMA",
      "URINE",
      "STOOL",
      "SALIVA",
      "SWAB",
      "TISSUE",
      "CSF",
      "SPUTUM",
      "OTHER",
    ])
    .optional(),
  /** ICD-10 prefix the calling visit is using — boosts matching tests. */
  forCode: z.string().trim().optional(),
  active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export const CreateLabOrderSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1).nullish(),
  visitNoteId: z.string().min(1).nullish(),
  testCodes: z.array(z.string().min(1)).default([]),
  panelCodes: z.array(z.string().min(1)).default([]),
  diagnosisCode: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
  urgency: z.enum(["ROUTINE", "URGENT", "STAT"]).default("ROUTINE"),
});

export const QueryLabOrdersSchema = z.object({
  patientId: z.string().min(1).optional(),
  visitNoteId: z.string().min(1).optional(),
  status: z
    .enum(["DRAFT", "ORDERED", "COLLECTED", "COMPLETED", "CANCELLED"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
