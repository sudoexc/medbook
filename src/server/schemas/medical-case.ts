import { z } from "zod";

export const CaseStatusEnum = z.enum([
  "OPEN",
  "RESOLVED",
  "ABANDONED",
  "TRANSFERRED",
]);

export const CreateMedicalCaseSchema = z.object({
  patientId: z.string().min(1),
  title: z.string().min(1).max(120),
  primaryDoctorId: z.string().optional().nullable(),
  primaryComplaint: z.string().max(5000).optional().nullable(),
  diagnosisText: z.string().max(5000).optional().nullable(),
  diagnosisCode: z.string().max(64).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: CaseStatusEnum.optional(),
});

// Partial update — only the fields explicitly listed in the spec are mutable.
// We intentionally omit `patientId` (cases don't move between patients) and
// `openedAt`/`closedAt`/`createdAt`/`updatedAt` (server-managed timestamps).
export const UpdateMedicalCaseSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  status: CaseStatusEnum.optional(),
  primaryDoctorId: z.string().nullable().optional(),
  primaryComplaint: z.string().max(5000).nullable().optional(),
  diagnosisText: z.string().max(5000).nullable().optional(),
  diagnosisCode: z.string().max(64).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  closedReason: z.string().max(500).nullable().optional(),
  // Phase 15 Wave 5 — AI SOAP draft (markdown with `### Subjective` etc.).
  // Initially populated by the voice-soap worker; doctor edits it via
  // `<SoapDraftCard>`. Capped at 20 KB which is overkill for SOAP but cheap.
  soapDraft: z.string().max(20000).nullable().optional(),
});

export const QueryMedicalCaseSchema = z.object({
  patientId: z.string().optional(),
  doctorId: z.string().optional(),
  // `status` may be a single value or repeated (`?status=OPEN&status=RESOLVED`).
  status: z
    .union([CaseStatusEnum, z.array(CaseStatusEnum)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z
    .enum(["openedAt", "updatedAt", "createdAt", "title"])
    .default("openedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

export const AttachAppointmentSchema = z.object({
  appointmentId: z.string().min(1),
});

export type CreateMedicalCase = z.infer<typeof CreateMedicalCaseSchema>;
export type UpdateMedicalCase = z.infer<typeof UpdateMedicalCaseSchema>;
export type QueryMedicalCase = z.infer<typeof QueryMedicalCaseSchema>;
export type AttachAppointmentBody = z.infer<typeof AttachAppointmentSchema>;
