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
  doctorId: z.string().optional(),
  type: DocumentTypeEnum.optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  pendingSignature: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) =>
      typeof v === "boolean" ? v : v === "true" ? true : false,
    ),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
