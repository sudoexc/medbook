/**
 * Phase 9c — Schema-level guards for the branches CRUD endpoints.
 *
 * Pure-Zod tests. We assert the `CreateBranchSchema` accepts canonical
 * shapes, rejects malformed slugs / overlong fields, and that
 * `SetActiveBranchSchema` accepts both a non-empty branchId and an explicit
 * `null` (clear-cookie). These cover the validation contract that the
 * route handlers in `src/app/api/crm/branches/*` rely on.
 */
import { describe, it, expect } from "vitest";

import {
  CreateBranchSchema,
  UpdateBranchSchema,
  SetActiveBranchSchema,
  QueryBranchSchema,
} from "@/server/schemas/branch";

describe("CreateBranchSchema", () => {
  it("accepts a minimal valid branch", () => {
    const r = CreateBranchSchema.safeParse({
      slug: "downtown",
      nameRu: "Центральный филиал",
      nameUz: "Markaziy filial",
    });
    expect(r.success).toBe(true);
  });

  it("accepts the full payload with optional fields", () => {
    const r = CreateBranchSchema.safeParse({
      slug: "hq",
      nameRu: "Главный",
      nameUz: "Asosiy",
      address: "Tashkent, Amir Temur 5",
      phone: "+998 90 000 00 00",
      timezone: "Asia/Tashkent",
      isDefault: true,
      isActive: true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects slug with uppercase or spaces", () => {
    const bad = ["HQ", "main branch", "филиал", "hq_"];
    for (const slug of bad) {
      const r = CreateBranchSchema.safeParse({
        slug,
        nameRu: "x",
        nameUz: "y",
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects too-short slug", () => {
    const r = CreateBranchSchema.safeParse({
      slug: "h",
      nameRu: "x",
      nameUz: "y",
    });
    expect(r.success).toBe(false);
  });

  it("requires both nameRu and nameUz", () => {
    const r1 = CreateBranchSchema.safeParse({
      slug: "hq",
      nameRu: "",
      nameUz: "Asosiy",
    });
    const r2 = CreateBranchSchema.safeParse({
      slug: "hq",
      nameRu: "Главный",
      nameUz: "",
    });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("UpdateBranchSchema makes everything optional", () => {
    const r = UpdateBranchSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("UpdateBranchSchema accepts isActive=false alone (deactivate via PATCH)", () => {
    const r = UpdateBranchSchema.safeParse({ isActive: false });
    expect(r.success).toBe(true);
  });
});

describe("SetActiveBranchSchema", () => {
  it("accepts a branchId string", () => {
    const r = SetActiveBranchSchema.safeParse({ branchId: "br_abc123" });
    expect(r.success).toBe(true);
  });

  it("accepts null as 'clear cookie'", () => {
    const r = SetActiveBranchSchema.safeParse({ branchId: null });
    expect(r.success).toBe(true);
  });

  it("rejects empty string (use null instead)", () => {
    const r = SetActiveBranchSchema.safeParse({ branchId: "" });
    expect(r.success).toBe(false);
  });

  it("rejects missing branchId field", () => {
    const r = SetActiveBranchSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("QueryBranchSchema", () => {
  it("coerces isActive=true from query string", () => {
    const r = QueryBranchSchema.safeParse({ isActive: "true", limit: "50" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isActive).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });

  it("defaults limit to 100 when absent", () => {
    const r = QueryBranchSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.limit).toBe(100);
    }
  });
});
