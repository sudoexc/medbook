/**
 * Zod schemas for P2.1 — clinical referrals (направления).
 *
 * A referral targets EITHER an internal colleague (`toDoctorId`, a User id) OR
 * an outside clinic/specialty (`externalTo`, free text) — never both, never
 * neither, so the route always knows where the patient is being sent.
 * `diagnosisCode`/`diagnosisName` are an ICD-10 snapshot taken at issue time.
 */
import { z } from "zod";

export const CreateReferralSchema = z
  .object({
    patientId: z.string().min(1),
    // Internal target colleague (a User id). Mutually exclusive with externalTo.
    toDoctorId: z.string().min(1).nullish(),
    // External clinic / specialty as free text. Mutually exclusive with toDoctorId.
    externalTo: z.string().trim().min(1).max(500).nullish(),
    // Originating visit (optional — a referral can be raised outside a visit).
    visitNoteId: z.string().min(1).nullish(),
    reason: z.string().trim().min(1, "reason required").max(5000),
    diagnosisCode: z.string().trim().max(20).nullish(),
    diagnosisName: z.string().trim().max(500).nullish(),
  })
  .refine((v) => Boolean(v.toDoctorId) !== Boolean(v.externalTo), {
    message: "exactly one of toDoctorId or externalTo is required",
    path: ["toDoctorId"],
  });

export const QueryReferralsSchema = z.object({
  // incoming → addressed to me (toDoctorId); outgoing → authored by me
  // (fromDoctorId). Omitted: a doctor sees both their sides; admin/nurse see
  // the whole clinic (optionally narrowed by patientId).
  scope: z.enum(["incoming", "outgoing"]).optional(),
  patientId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
