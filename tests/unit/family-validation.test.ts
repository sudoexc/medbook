/**
 * Phase 16 Wave 1 — Family account validation.
 *
 * Locks the predicates the `/api/miniapp/family` POST route relies on
 * before any DB write happens: invalid relationship, self-link, max-cap
 * overflow, duplicate link, and the claim-vs-create branch decision.
 */
import { describe, expect, it } from "vitest";

import {
  AddFamilyMemberSchema,
  FAMILY_RELATIONSHIPS,
  MAX_FAMILY_LINKS,
  decideClaimOrCreate,
  validateFamilyAddition,
} from "@/server/services/family";

describe("validateFamilyAddition", () => {
  const baseArgs = {
    ownerPatientId: "owner-1",
    candidateLinkedPatientId: "linked-1",
    relationship: "child" as const,
    existingLinkCount: 0,
    alreadyLinkedPatientIds: new Set<string>(),
  };

  it("returns null for a valid request", () => {
    expect(validateFamilyAddition(baseArgs)).toBeNull();
  });

  it("rejects when relationship is not in the allowed set", () => {
    const result = validateFamilyAddition({
      ...baseArgs,
      relationship: "co-worker",
    });
    expect(result).toEqual({ kind: "invalid_relationship" });
  });

  it("rejects self-link (owner == candidate)", () => {
    const result = validateFamilyAddition({
      ...baseArgs,
      candidateLinkedPatientId: baseArgs.ownerPatientId,
    });
    expect(result).toEqual({ kind: "self_link" });
  });

  it("rejects when the owner has already hit MAX_FAMILY_LINKS", () => {
    const result = validateFamilyAddition({
      ...baseArgs,
      existingLinkCount: MAX_FAMILY_LINKS,
    });
    expect(result).toEqual({
      kind: "max_reached",
      max: MAX_FAMILY_LINKS,
    });
  });

  it("rejects when the same patient is already linked (duplicate)", () => {
    const result = validateFamilyAddition({
      ...baseArgs,
      alreadyLinkedPatientIds: new Set(["linked-1"]),
    });
    expect(result).toEqual({ kind: "duplicate" });
  });

  it("does not flag duplicate when the candidate is null (create-new flow)", () => {
    const result = validateFamilyAddition({
      ...baseArgs,
      candidateLinkedPatientId: null,
      alreadyLinkedPatientIds: new Set(["other-id"]),
    });
    expect(result).toBeNull();
  });

  it("checks invalid_relationship before self_link to surface the most specific error first", () => {
    const result = validateFamilyAddition({
      ...baseArgs,
      relationship: "garbage",
      candidateLinkedPatientId: baseArgs.ownerPatientId,
    });
    expect(result).toEqual({ kind: "invalid_relationship" });
  });

  it("MAX_FAMILY_LINKS is locked to 5 (spec)", () => {
    expect(MAX_FAMILY_LINKS).toBe(5);
  });

  it("FAMILY_RELATIONSHIPS exposes exactly the four spec values", () => {
    expect(new Set(FAMILY_RELATIONSHIPS)).toEqual(
      new Set(["child", "spouse", "parent", "other"]),
    );
  });
});

describe("decideClaimOrCreate", () => {
  it("returns 'claim' when an existing patient row matches", () => {
    expect(decideClaimOrCreate({ matchedPatientId: "p-99" })).toBe("claim");
  });

  it("returns 'create' when no match was found", () => {
    expect(decideClaimOrCreate({ matchedPatientId: null })).toBe("create");
  });
});

describe("AddFamilyMemberSchema", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = AddFamilyMemberSchema.safeParse({
      fullName: "Иван Иванов",
      relationship: "child",
    });
    expect(parsed.success).toBe(true);
  });

  it("trims fullName and rejects too-short names", () => {
    const parsed = AddFamilyMemberSchema.safeParse({
      fullName: "A",
      relationship: "child",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts gender + plain YYYY-MM-DD birthDate", () => {
    const parsed = AddFamilyMemberSchema.safeParse({
      fullName: "Анна Иванова",
      relationship: "spouse",
      gender: "FEMALE",
      birthDate: "1990-04-21",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid relationship value", () => {
    const parsed = AddFamilyMemberSchema.safeParse({
      fullName: "Иван Иванов",
      relationship: "co-worker",
    });
    expect(parsed.success).toBe(false);
  });
});
