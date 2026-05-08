/**
 * Phase 19 Wave 2 — signup token validation + confirm-handler guards.
 *
 * Two layers of coverage:
 *
 * 1. **Schema** — SignupRequestSchema and SignupConfirmSchema reject the
 *    obvious failure modes (too-short token, bad email, oversized
 *    fields). This is fast feedback that the public endpoints don't
 *    accept garbage before any DB call.
 *
 * 2. **Confirm-handler guards** — direct unit pass over the time / state
 *    branching logic the confirm route relies on (consumed-at,
 *    expires-at). We don't import the route handler (it pulls in
 *    Next-runtime + Prisma); instead we replicate the predicate so the
 *    intent of the guard is tested in isolation.
 */
import { describe, it, expect } from "vitest";

import {
  SignupRequestSchema,
  SignupConfirmSchema,
} from "@/server/schemas/signup";

describe("SignupRequestSchema", () => {
  it("accepts a minimal valid payload", () => {
    const r = SignupRequestSchema.safeParse({
      clinicName: "NeuroFax Tashkent",
      email: "Owner@CLINIC.uz",
      preferredLocale: "ru",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("owner@clinic.uz");
      expect(r.data.planSlug).toBe("basic");
    }
  });

  it("rejects clinicName under 2 chars", () => {
    const r = SignupRequestSchema.safeParse({
      clinicName: "X",
      email: "ok@x.uz",
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed email", () => {
    const r = SignupRequestSchema.safeParse({
      clinicName: "Clinic",
      email: "not-an-email",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown playbookSlug", () => {
    const r = SignupRequestSchema.safeParse({
      clinicName: "Clinic",
      email: "ok@x.uz",
      playbookSlug: "intergalactic",
    });
    expect(r.success).toBe(false);
  });

  it("accepts null playbookSlug as start-blank", () => {
    const r = SignupRequestSchema.safeParse({
      clinicName: "Clinic",
      email: "ok@x.uz",
      playbookSlug: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unsupported preferredLocale", () => {
    const r = SignupRequestSchema.safeParse({
      clinicName: "Clinic",
      email: "ok@x.uz",
      preferredLocale: "en",
    });
    expect(r.success).toBe(false);
  });
});

describe("SignupConfirmSchema", () => {
  it("accepts a 32-char base64url-ish token", () => {
    const r = SignupConfirmSchema.safeParse({
      token: "abcdefghijklmnopqrstuvwxyz012345",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an empty token", () => {
    const r = SignupConfirmSchema.safeParse({ token: "" });
    expect(r.success).toBe(false);
  });

  it("rejects a 7-char token (below floor)", () => {
    const r = SignupConfirmSchema.safeParse({ token: "abcdefg" });
    expect(r.success).toBe(false);
  });

  it("rejects a 201-char token (above ceiling)", () => {
    const r = SignupConfirmSchema.safeParse({ token: "x".repeat(201) });
    expect(r.success).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Confirm-handler guard predicates.
// Mirrors the logic in `src/app/api/public/signup/confirm/route.ts`. Keeping
// them isolated lets us prove the time arithmetic without spinning the
// handler up.
// ───────────────────────────────────────────────────────────────────────────

interface TokenRow {
  consumedAt: Date | null;
  expiresAt: Date;
}

function classifyToken(row: TokenRow | null, now: number):
  | "valid"
  | "not_found"
  | "consumed"
  | "expired" {
  if (!row) return "not_found";
  if (row.consumedAt) return "consumed";
  if (row.expiresAt.getTime() <= now) return "expired";
  return "valid";
}

describe("classifyToken (mirrors confirm-route guards)", () => {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0); // 2026-05-07T12:00:00Z

  it("not_found when row is null", () => {
    expect(classifyToken(null, now)).toBe("not_found");
  });

  it("consumed when consumedAt is set, even within TTL", () => {
    expect(
      classifyToken(
        {
          consumedAt: new Date(now - 1000),
          expiresAt: new Date(now + 60_000),
        },
        now,
      ),
    ).toBe("consumed");
  });

  it("expired when expiresAt is at or before now", () => {
    expect(
      classifyToken(
        { consumedAt: null, expiresAt: new Date(now) },
        now,
      ),
    ).toBe("expired");
    expect(
      classifyToken(
        { consumedAt: null, expiresAt: new Date(now - 1) },
        now,
      ),
    ).toBe("expired");
  });

  it("valid when not consumed and expiresAt is in the future", () => {
    const ONE_SECOND = 1000;
    expect(
      classifyToken(
        { consumedAt: null, expiresAt: new Date(now + ONE_SECOND) },
        now,
      ),
    ).toBe("valid");
  });

  it("24h-from-mint token is valid right after creation, expired after 24h+1ms", () => {
    const TTL = 24 * 60 * 60 * 1000;
    const mintedAt = now;
    const expiresAt = new Date(mintedAt + TTL);
    expect(
      classifyToken({ consumedAt: null, expiresAt }, mintedAt),
    ).toBe("valid");
    expect(
      classifyToken({ consumedAt: null, expiresAt }, mintedAt + TTL + 1),
    ).toBe("expired");
  });
});
