/**
 * Phase 17 Wave 2 — audit-action constant existence.
 *
 * The ROADMAP spec calls out 9 distinct audit actions. We don't care about
 * the value strings (those go to the DB and are intentionally human-readable),
 * only that each constant key exists and is non-empty — i.e. someone can't
 * silently delete one and ship.
 */
import { describe, it, expect } from "vitest";

import { AUDIT_ACTION } from "@/lib/audit-actions";

const W2_KEYS = [
  "TOTP_ENROLLED",
  "TOTP_DISABLED",
  "RECOVERY_CODES_REGENERATED",
  "RECOVERY_CODE_USED",
  "SESSION_TIMEOUT_LOGOUT",
  "SESSION_FORCED_REROTATE",
  "CONCURRENT_SESSION_KICKED",
  "CLINIC_2FA_REQUIREMENT_CHANGED",
  "CLINIC_SESSION_IDLE_CHANGED",
] as const;

describe("Phase 17 Wave 2 audit actions", () => {
  it.each(W2_KEYS)("%s constant exists and is non-empty", (k) => {
    const v = (AUDIT_ACTION as Record<string, string>)[k];
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("each constant value is unique within the AUDIT_ACTION map", () => {
    const values = Object.values(AUDIT_ACTION);
    expect(new Set(values).size).toBe(values.length);
  });
});
