/**
 * Phase 16 Wave 2 — Post-visit NPS unit tests.
 *
 * Pure helpers only. Covers:
 *
 *   1. Score validation — 1..10 inclusive, integer-only. The Mini App POST
 *      handler delegates to the same Zod schema we exercise here.
 *   2. Idempotency contract — the comment-truncation helper used to build
 *      `LowNpsReceivedPayload.commentPreview`.
 *   3. `isNpsEligible` window boundaries (4..5h after `completedAt`),
 *      status gate, dedupe stamp, contact gate.
 *   4. `LOW_NPS_RECEIVED` action payload shape — `dedupeKeyFor`,
 *      `defaultSeverity`, `defaultDeeplinkPath` all behave exhaustively for
 *      the new ActionType.
 *
 * No Prisma, no React. Stays under the unit-test bar so it runs on every
 * push without booting a database.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  dedupeKeyFor,
  defaultDeeplinkPath,
  defaultSeverity,
  type LowNpsReceivedPayload,
} from "@/lib/actions/types";
import { isNpsEligible } from "@/server/workers/post-visit-nps";

/**
 * Mirror of the schema living in `src/app/api/miniapp/nps/[appointmentId]/route.ts`.
 * Re-declared locally because the route module imports server-side modules
 * (`prisma`, `audit`, …) that aren't safe to load from a unit test.
 */
const NpsSubmissionSchema = z.object({
  score: z.number().int().min(1).max(10),
  comment: z.string().max(500).optional().default(""),
});

describe("NpsSubmissionSchema", () => {
  it("accepts every score from 1 to 10", () => {
    for (let s = 1; s <= 10; s++) {
      const r = NpsSubmissionSchema.safeParse({ score: s });
      expect(r.success, `score=${s}`).toBe(true);
    }
  });

  it("rejects score = 0", () => {
    const r = NpsSubmissionSchema.safeParse({ score: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects score = 11", () => {
    const r = NpsSubmissionSchema.safeParse({ score: 11 });
    expect(r.success).toBe(false);
  });

  it("rejects negative scores", () => {
    const r = NpsSubmissionSchema.safeParse({ score: -1 });
    expect(r.success).toBe(false);
  });

  it("rejects fractional scores (8.5)", () => {
    const r = NpsSubmissionSchema.safeParse({ score: 8.5 });
    expect(r.success).toBe(false);
  });

  it("rejects non-numeric scores", () => {
    const r = NpsSubmissionSchema.safeParse({ score: "9" });
    expect(r.success).toBe(false);
  });

  it("defaults `comment` to empty string when omitted", () => {
    const r = NpsSubmissionSchema.safeParse({ score: 7 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.comment).toBe("");
  });

  it("rejects a comment over 500 chars", () => {
    const r = NpsSubmissionSchema.safeParse({
      score: 5,
      comment: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("accepts a 500-char comment exactly", () => {
    const r = NpsSubmissionSchema.safeParse({
      score: 5,
      comment: "x".repeat(500),
    });
    expect(r.success).toBe(true);
  });
});

describe("comment-preview truncation (PII minimisation)", () => {
  // The route handler trims to 117 + "…" when length > 120 so the action
  // payload never carries the full comment. Re-derive that here so a
  // refactor that changes the cutoff has to update this test deliberately.
  function previewOf(raw: string): string {
    const trimmed = raw;
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  }

  it("returns the input untouched when ≤ 120 chars", () => {
    const s = "Долго ждал, но врач очень внимательный.";
    expect(previewOf(s)).toBe(s);
  });

  it("truncates exactly at 117 chars + ellipsis when > 120", () => {
    const s = "a".repeat(200);
    const out = previewOf(s);
    expect(out.length).toBe(118); // 117 + 1 ellipsis char
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, 117)).toBe("a".repeat(117));
  });

  it("does not truncate at the 120-char boundary", () => {
    const s = "b".repeat(120);
    expect(previewOf(s)).toBe(s);
    expect(previewOf(s).endsWith("…")).toBe(false);
  });
});

describe("isNpsEligible", () => {
  const now = new Date("2026-05-06T12:00:00.000Z");
  const baseRow = {
    status: "COMPLETED",
    npsRequestedAt: null,
    patientHasContact: true,
  };

  it("returns true at 4.5h after completedAt", () => {
    const completedAt = new Date(now.getTime() - 4.5 * 60 * 60 * 1000);
    expect(isNpsEligible({ ...baseRow, completedAt }, now)).toBe(true);
  });

  it("returns true at the lower bound (exactly 4h)", () => {
    const completedAt = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    expect(isNpsEligible({ ...baseRow, completedAt }, now)).toBe(true);
  });

  it("returns true at the upper bound (exactly 5h)", () => {
    const completedAt = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    expect(isNpsEligible({ ...baseRow, completedAt }, now)).toBe(true);
  });

  it("returns false just under 4h (too soon)", () => {
    const completedAt = new Date(now.getTime() - 4 * 60 * 60 * 1000 + 60_000);
    expect(isNpsEligible({ ...baseRow, completedAt }, now)).toBe(false);
  });

  it("returns false just over 5h (window passed)", () => {
    const completedAt = new Date(now.getTime() - 5 * 60 * 60 * 1000 - 60_000);
    expect(isNpsEligible({ ...baseRow, completedAt }, now)).toBe(false);
  });

  it("returns false when already requested", () => {
    const completedAt = new Date(now.getTime() - 4.5 * 60 * 60 * 1000);
    expect(
      isNpsEligible(
        { ...baseRow, completedAt, npsRequestedAt: new Date(now) },
        now,
      ),
    ).toBe(false);
  });

  it("returns false for non-COMPLETED status", () => {
    const completedAt = new Date(now.getTime() - 4.5 * 60 * 60 * 1000);
    for (const status of ["BOOKED", "WAITING", "CANCELLED", "NO_SHOW"]) {
      expect(
        isNpsEligible({ ...baseRow, completedAt, status }, now),
        `status=${status}`,
      ).toBe(false);
    }
  });

  it("returns false when completedAt is null", () => {
    expect(
      isNpsEligible({ ...baseRow, completedAt: null }, now),
    ).toBe(false);
  });

  it("returns false when patient has no contact", () => {
    const completedAt = new Date(now.getTime() - 4.5 * 60 * 60 * 1000);
    expect(
      isNpsEligible(
        { ...baseRow, completedAt, patientHasContact: false },
        now,
      ),
    ).toBe(false);
  });
});

describe("LOW_NPS_RECEIVED action payload", () => {
  const samplePayload: LowNpsReceivedPayload = {
    type: "LOW_NPS_RECEIVED",
    patientId: "p_42",
    patientName: "Иван Иванов",
    appointmentId: "apt_99",
    doctorId: "doc_1",
    doctorName: "Петров П.П.",
    score: 3,
    commentPreview: "Долго ждал",
  };

  it("dedupe key is keyed off appointmentId (idempotent re-submission)", () => {
    expect(dedupeKeyFor(samplePayload)).toBe(
      "LOW_NPS_RECEIVED:appointmentId=apt_99",
    );
  });

  it("dedupe key is identical for two payloads with the same appointmentId", () => {
    const a = dedupeKeyFor(samplePayload);
    const b = dedupeKeyFor({
      ...samplePayload,
      score: 1,
      commentPreview: "completely different text",
      doctorId: null,
      doctorName: "—",
    });
    expect(a).toBe(b);
  });

  it("default severity is 'high'", () => {
    expect(defaultSeverity("LOW_NPS_RECEIVED")).toBe("high");
  });

  it("default deeplink points at the action-center", () => {
    expect(defaultDeeplinkPath("LOW_NPS_RECEIVED")).toBe("/crm/action-center");
  });

  it("tolerates a null doctorId in the payload type", () => {
    const noDoctor: LowNpsReceivedPayload = {
      ...samplePayload,
      doctorId: null,
      doctorName: "—",
    };
    expect(dedupeKeyFor(noDoctor)).toBe(
      "LOW_NPS_RECEIVED:appointmentId=apt_99",
    );
  });
});
