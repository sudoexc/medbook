/**
 * Schema tests for /api/crm/users and the Phase-4 settings payloads.
 *
 * These are pure Zod tests covering RBAC-relevant shapes:
 *   - Users CRUD payloads (create/update/query)
 *   - Clinic settings (tenant admin)
 *   - Integration secrets (current-password re-entry requirement)
 *   - Reset-password payload
 *   - Test-SMS payload
 */
import { describe, it, expect } from "vitest";

import {
  CreateUserSchema,
  UpdateUserSchema,
  QueryUserSchema,
} from "@/server/schemas/user";
import {
  UpdateClinicSettingsSchema,
  UpsertProviderSchema,
  ClinicSecretsSchema,
  ResetPasswordSchema,
  TestSmsSchema,
} from "@/server/schemas/settings";

describe("CreateUserSchema", () => {
  it("accepts a minimal admin payload", () => {
    const r = CreateUserSchema.safeParse({
      email: "admin@clinic.test",
      name: "Admin",
      role: "ADMIN",
    });
    expect(r.success).toBe(true);
  });

  it("accepts all supported staff roles", () => {
    for (const role of [
      "ADMIN",
      "DOCTOR",
      "RECEPTIONIST",
      "NURSE",
      "CALL_OPERATOR",
    ] as const) {
      const r = CreateUserSchema.safeParse({
        email: `x+${role}@clinic.test`,
        name: role,
        role,
        // role=DOCTOR requires a Doctor card to bind to (see #193).
        ...(role === "DOCTOR" ? { doctorId: "doc_test_123" } : {}),
      });
      expect(r.success, `role=${role}`).toBe(true);
    }
  });

  it("rejects role=DOCTOR without doctorId", () => {
    const r = CreateUserSchema.safeParse({
      email: "doc@clinic.test",
      name: "Doc",
      role: "DOCTOR",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid role", () => {
    const r = CreateUserSchema.safeParse({
      email: "x@clinic.test",
      name: "x",
      role: "ROOT",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const r = CreateUserSchema.safeParse({
      email: "not-an-email",
      name: "x",
      role: "ADMIN",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a password shorter than 8 chars", () => {
    const r = CreateUserSchema.safeParse({
      email: "x@clinic.test",
      name: "x",
      role: "ADMIN",
      password: "short",
    });
    expect(r.success).toBe(false);
  });

  it("allows SUPER_ADMIN at the schema level (route layer rejects it)", () => {
    // The API route — not the schema — is where tenant-scoped endpoints
    // reject SUPER_ADMIN creation. The schema itself only validates shape.
    const r = CreateUserSchema.safeParse({
      email: "su@clinic.test",
      name: "SU",
      role: "SUPER_ADMIN",
    });
    expect(r.success).toBe(true);
  });
});

describe("UpdateUserSchema", () => {
  it("accepts an empty partial update", () => {
    const r = UpdateUserSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts an active-flag flip", () => {
    const r = UpdateUserSchema.safeParse({ active: false });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown role on update", () => {
    const r = UpdateUserSchema.safeParse({ role: "GUEST" });
    expect(r.success).toBe(false);
  });
});

describe("QueryUserSchema", () => {
  it("coerces limit from string", () => {
    const r = QueryUserSchema.safeParse({ limit: "25" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });

  it("caps limit at 1000", () => {
    const r = QueryUserSchema.safeParse({ limit: "1500" });
    expect(r.success).toBe(false);
  });

  it("accepts limit up to 1000", () => {
    const r = QueryUserSchema.safeParse({ limit: "1000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(1000);
  });

  it("defaults limit to 50 when omitted", () => {
    const r = QueryUserSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

describe("UpdateClinicSettingsSchema", () => {
  it("accepts a partial clinic update", () => {
    const r = UpdateClinicSettingsSchema.safeParse({
      nameRu: "NeuroFax",
      timezone: "Asia/Tashkent",
      slotMin: 15,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a malformed brand color", () => {
    const r = UpdateClinicSettingsSchema.safeParse({ brandColor: "red" });
    expect(r.success).toBe(false);
  });

  it("accepts hex brand color", () => {
    const r = UpdateClinicSettingsSchema.safeParse({ brandColor: "#1a2b3c" });
    expect(r.success).toBe(true);
  });

  it("rejects a slot of 1 minute", () => {
    const r = UpdateClinicSettingsSchema.safeParse({ slotMin: 1 });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed workday start", () => {
    const r = UpdateClinicSettingsSchema.safeParse({ workdayStart: "8am" });
    expect(r.success).toBe(false);
  });

  it("accepts null secondary currency", () => {
    const r = UpdateClinicSettingsSchema.safeParse({ secondaryCurrency: null });
    expect(r.success).toBe(true);
  });
});

describe("ClinicSecretsSchema", () => {
  it("requires currentPassword", () => {
    const r = ClinicSecretsSchema.safeParse({ tgBotToken: "abc" });
    expect(r.success).toBe(false);
  });

  it("accepts a token change with password", () => {
    const r = ClinicSecretsSchema.safeParse({
      tgBotToken: "123:abc",
      currentPassword: "hunter22",
    });
    expect(r.success).toBe(true);
  });
});

describe("UpsertProviderSchema", () => {
  it("accepts a label-only upsert without secret", () => {
    const r = UpsertProviderSchema.safeParse({
      kind: "TELEGRAM",
      label: "Main bot",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a secret change with currentPassword", () => {
    const r = UpsertProviderSchema.safeParse({
      kind: "SMS",
      label: "Eskiz",
      secret: "api-token",
      currentPassword: "hunter22",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown provider kind", () => {
    const r = UpsertProviderSchema.safeParse({
      kind: "FAX",
    });
    expect(r.success).toBe(false);
  });
});

describe("ResetPasswordSchema", () => {
  it("allows an empty payload (server-side generated password)", () => {
    const r = ResetPasswordSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects a 4-char password", () => {
    const r = ResetPasswordSchema.safeParse({ newPassword: "abcd" });
    expect(r.success).toBe(false);
  });

  it("accepts an 8-char password", () => {
    const r = ResetPasswordSchema.safeParse({ newPassword: "abcdefgh" });
    expect(r.success).toBe(true);
  });
});

describe("TestSmsSchema", () => {
  it("requires phone and body", () => {
    expect(TestSmsSchema.safeParse({ phone: "", body: "x" }).success).toBe(
      false,
    );
    expect(TestSmsSchema.safeParse({ phone: "+998", body: "" }).success).toBe(
      false,
    );
    expect(
      TestSmsSchema.safeParse({ phone: "+998901234567", body: "hi" }).success,
    ).toBe(true);
  });
});
