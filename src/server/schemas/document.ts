import { z } from "zod";

export const DocumentTypeEnum = z.enum([
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
]);

export const CreateDocumentSchema = z.object({
  patientId: z.string(),
  appointmentId: z.string().optional().nullable(),
  type: DocumentTypeEnum,
  title: z.string().min(1).max(300),
  fileUrl: z.string().min(1).max(1000),
  mimeType: z.string().max(120).optional().nullable(),
  sizeBytes: z.number().int().min(0).optional().nullable(),
});

export const QueryDocumentSchema = z.object({
  patientId: z.string().optional(),
  appointmentId: z.string().optional(),
  type: DocumentTypeEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
