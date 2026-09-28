/**
 * Phase 17 Wave 3 — anonymization payload helper.
 *
 * Pure function — no DB. Verifies:
 *  - Sentinel name is in Russian (the consent gate spec).
 *  - phoneNormalized uses the per-row `deleted:<jobId>` sentinel so
 *    `@@unique([clinicId, phoneNormalized])` doesn't fire.
 *  - All PII free-text fields are nulled.
 *  - marketingOptOut is forced on (`source: data-deletion`).
 *  - The `now` timestamp is wired into the three time stamps that need
 *    it (deletedAt, deletionRequestedAt, marketingOptOutAt).
 *  - The audit row names the erased fields instead of copying the
 *    person's identity (audit SEC-09).
 */
import { describe, it, expect } from "vitest";

import {
  ANONYMIZED_FULL_NAME,
  buildAnonymizationPayload,
  erasedIdentityFields,
} from "@/server/dsar/anonymize";

describe("buildAnonymizationPayload", () => {
  const jobId = "job_clu123";
  const now = new Date("2026-08-01T12:00:00.000Z");

  it("uses the canonical anonymized full-name sentinel", () => {
    const out = buildAnonymizationPayload(jobId, now);
    expect(out.fullName).toBe("Удалённый пациент");
    expect(out.fullName).toBe(ANONYMIZED_FULL_NAME);
  });

  it("encodes the jobId into phoneNormalized for uniqueness", () => {
    const out = buildAnonymizationPayload(jobId, now);
    expect(out.phoneNormalized).toBe(`deleted:${jobId}`);
    // Two different jobs must yield different sentinels.
    const other = buildAnonymizationPayload("job_clu456", now);
    expect(other.phoneNormalized).not.toBe(out.phoneNormalized);
  });

  it("nulls every PII free-text field", () => {
    const out = buildAnonymizationPayload(jobId, now);
    expect(out.passport).toBeNull();
    expect(out.address).toBeNull();
    expect(out.telegramId).toBeNull();
    expect(out.telegramUsername).toBeNull();
    expect(out.photoUrl).toBeNull();
    expect(out.notes).toBeNull();
    expect(out.summaryCache).toBeNull();
    expect(out.summaryCacheUpdatedAt).toBeNull();
    expect(out.tags).toEqual([]);
    expect(out.phone).toBe("");
  });

  it("flips marketing flags into opt-out (data-deletion)", () => {
    const out = buildAnonymizationPayload(jobId, now);
    expect(out.marketingOptOut).toBe(true);
    expect(out.consentMarketing).toBe(false);
    expect(out.marketingOptOutSource).toBe("data-deletion");
    expect(out.marketingOptOutAt).toEqual(now);
  });

  it("stamps `now` into deletedAt and deletionRequestedAt", () => {
    const out = buildAnonymizationPayload(jobId, now);
    expect(out.deletedAt).toEqual(now);
    expect(out.deletionRequestedAt).toEqual(now);
    expect(out.deletionReason).toBe(`dsar:${jobId}`);
  });

  it("the audit row names the erased identity fields, never their values (SEC-09)", () => {
    const fields = erasedIdentityFields({
      fullName: "Иван Иванов",
      phone: "+998 90 000 00 00",
      phoneNormalized: "998900000000",
      telegramId: "tg_42",
      telegramUsername: null,
      passport: "AB1234567",
    });
    expect(fields).toEqual([
      "fullName",
      "phone",
      "phoneNormalized",
      "telegramId",
      "passport",
    ]);
    expect(JSON.stringify(fields)).not.toContain("Иван");
    expect(JSON.stringify(fields)).not.toContain("AB1234567");
  });
});
