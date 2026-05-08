/**
 * Phase 16 Wave 1 — Family account validation helpers.
 *
 * Pure helpers (no Prisma) so they can be unit-tested against the same
 * predicates the API route uses. The actual DB writes live in the
 * `/api/miniapp/family` route handler.
 *
 * Rules enforced here:
 *   1. `relationship` must be one of FAMILY_RELATIONSHIPS.
 *   2. Self-link is rejected (owner == linked patient ID).
 *   3. A single owner can link to at most MAX_FAMILY_LINKS relatives.
 *   4. Duplicate link (owner + linked already exists) is rejected.
 *
 * Phone normalisation + the "claim existing relative if (fullName, phone)
 * matches inside the same clinic" lookup live in the route handler — they
 * need Prisma. The `findExistingPatientForClaim` helper here describes the
 * lookup contract so unit tests can mock it cleanly.
 */
import { z } from "zod";

export const FAMILY_RELATIONSHIPS = [
  "child",
  "spouse",
  "parent",
  "other",
] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

/**
 * Hard cap per spec — keeps the switcher UI compact and prevents abuse.
 * Bumped only with product approval (and a UI redesign for paginated
 * sheets).
 */
export const MAX_FAMILY_LINKS = 5;

export const AddFamilyMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(30).optional().nullable(),
  birthDate: z
    .string()
    .datetime()
    .optional()
    .nullable()
    // Allow plain "YYYY-MM-DD" too (Mini App date input emits this) by
    // letting the route normalise; we keep schema permissive for both.
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()),
  gender: z.enum(["MALE", "FEMALE"]).optional().nullable(),
  relationship: z.enum(FAMILY_RELATIONSHIPS),
});

export type AddFamilyMemberInput = z.infer<typeof AddFamilyMemberSchema>;

export type FamilyValidationError =
  | { kind: "self_link" }
  | { kind: "max_reached"; max: number }
  | { kind: "duplicate" }
  | { kind: "invalid_relationship" };

/**
 * Validate the request before we even hit Prisma. `existingLinkCount` is the
 * current `PatientFamily` count for the owner (in this clinic).
 * `alreadyLinkedPatientIds` is the set of currently linked patient IDs (so
 * we can short-circuit the "claim existing" path without a second query).
 */
export function validateFamilyAddition(args: {
  ownerPatientId: string;
  candidateLinkedPatientId: string | null;
  relationship: string;
  existingLinkCount: number;
  alreadyLinkedPatientIds: Set<string>;
}): FamilyValidationError | null {
  if (
    !FAMILY_RELATIONSHIPS.includes(args.relationship as FamilyRelationship)
  ) {
    return { kind: "invalid_relationship" };
  }
  if (
    args.candidateLinkedPatientId &&
    args.candidateLinkedPatientId === args.ownerPatientId
  ) {
    return { kind: "self_link" };
  }
  if (args.existingLinkCount >= MAX_FAMILY_LINKS) {
    return { kind: "max_reached", max: MAX_FAMILY_LINKS };
  }
  if (
    args.candidateLinkedPatientId &&
    args.alreadyLinkedPatientIds.has(args.candidateLinkedPatientId)
  ) {
    return { kind: "duplicate" };
  }
  return null;
}

/**
 * Decide whether to reuse an existing patient row (claim path) or create a
 * brand-new one. Pure — the candidate match has already been resolved by
 * the caller via `prisma.patient.findFirst({ clinicId, fullName, phoneNormalized })`.
 */
export function decideClaimOrCreate(args: {
  matchedPatientId: string | null;
}): "claim" | "create" {
  return args.matchedPatientId ? "claim" : "create";
}
