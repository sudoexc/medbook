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

/**
 * PATCH /api/crm/documents/[id] — editable subset of a Document row.
 *
 * `type` reuses DocumentTypeEnum, which intentionally does NOT contain
 * CONCLUSION: conclusions are rendered by the visit-note worker from a
 * VisitNote and must never be created or converted-to by hand. The same
 * guard exists server-side for documents that already ARE conclusions.
 *
 * `fileUrl`/`mimeType`/`sizeBytes` travel together when the doctor replaces
 * the underlying file (bytes go through POST /api/crm/documents/upload
 * first, then the resulting URL is persisted here).
 */
export const UpdateDocumentSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    type: DocumentTypeEnum.optional(),
    fileUrl: z.string().min(1).max(1000).optional(),
    mimeType: z.string().max(120).optional().nullable(),
    sizeBytes: z.number().int().min(0).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

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
