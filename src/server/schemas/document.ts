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

export const DocumentSourceEnum = z.enum(["STAFF", "PATIENT", "SYSTEM"]);

/**
 * `uploadToken` is the receipt `POST /api/crm/documents/upload` returns with
 * the `fileUrl` of the bytes it stored. A `fileUrl` into our storage is
 * accepted only with it; anything else must be an `https:` link (audit CD-08).
 * The signature pad uploads its PNG the same way: an inline data: URL never
 * fit the 1000-character column limit, so the pad never saved (CD-05).
 *
 * `signsDocumentId` names an unsigned consent or contract of the same
 * patient that this signature (the pad's PNG, filed as a consent) signs;
 * both are stamped signed. A signature with no consent behind it is not a
 * signed consent: the pad files it as OTHER, unsigned and deletable, so a
 * scribble on the wrong patient's card never becomes a legal record.
 */
export const CreateDocumentSchema = z.object({
  patientId: z.string(),
  appointmentId: z.string().optional().nullable(),
  type: DocumentTypeEnum,
  title: z.string().min(1).max(300),
  fileUrl: z.string().min(1).max(1000),
  uploadToken: z.string().max(200).optional().nullable(),
  mimeType: z.string().max(120).optional().nullable(),
  sizeBytes: z.number().int().min(0).optional().nullable(),
  signsDocumentId: z.string().min(1).max(64).optional().nullable(),
});

/**
 * PATCH /api/crm/documents/[id] — editable subset of a Document row.
 *
 * `type` reuses DocumentTypeEnum, which intentionally does NOT contain
 * CONCLUSION: conclusions are rendered by the visit-note worker from a
 * VisitNote and must never be created or converted-to by hand. The same
 * guard exists server-side for documents that already ARE conclusions.
 *
 * `fileUrl`/`uploadToken`/`mimeType`/`sizeBytes` travel together when the
 * doctor replaces the underlying file (bytes go through POST
 * /api/crm/documents/upload first, then the resulting URL is persisted here
 * with the upload's receipt).
 */
export const UpdateDocumentSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    type: DocumentTypeEnum.optional(),
    fileUrl: z.string().min(1).max(1000).optional(),
    uploadToken: z.string().max(200).optional().nullable(),
    mimeType: z.string().max(120).optional().nullable(),
    sizeBytes: z.number().int().min(0).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

/**
 * POST /api/crm/documents/[id]/void: ADMIN voids a signed record filed by
 * mistake (CD-09). The reason is required: it is the only account of why a
 * legal record stopped counting.
 */
export const VoidDocumentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const QueryDocumentSchema = z.object({
  patientId: z.string().optional(),
  appointmentId: z.string().optional(),
  doctorId: z.string().optional(),
  type: DocumentTypeEnum.optional(),
  /** CD-06: «от пациента» / clinic upload / rendered by the system. */
  source: DocumentSourceEnum.optional(),
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
