/**
 * Tenancy-isolation sanity tests.
 *
 * These are documentation-level assertions — they validate that the
 * helpers we rely on to enforce multi-tenancy behave correctly. A full
 * round-trip test that spins up two clinics against a real Postgres
 * instance lives in tests/e2e (Phase-7) because it requires a DB.
 *
 * The critical invariants are:
 *   1. TenantContext can hold TENANT / SUPER_ADMIN / SYSTEM kinds.
 *   2. The clinicId is only exposed for TENANT contexts.
 *   3. Tenant A and Tenant B in parallel runWithTenant calls do NOT
 *      leak context into each other.
 */
import { describe, it, expect } from "vitest";

import {
  getClinicId,
  getTenant,
  runWithTenant,
  type TenantContext,
} from "@/lib/tenant-context";
import { MODELS_WITHOUT_TENANT, MODELS_TENANT_BYPASSABLE } from "@/lib/tenant-allowlist";

describe("tenancy isolation", () => {
  it("allowlist: AuditLog and auth models have no tenant column", () => {
    expect(MODELS_WITHOUT_TENANT.has("AuditLog")).toBe(true);
    expect(MODELS_WITHOUT_TENANT.has("User")).toBe(true);
    expect(MODELS_WITHOUT_TENANT.has("Clinic")).toBe(true);
    // Domain models MUST be scoped.
    expect(MODELS_WITHOUT_TENANT.has("Patient")).toBe(false);
    expect(MODELS_WITHOUT_TENANT.has("Appointment")).toBe(false);
  });

  it("allowlist: ExchangeRate and ProviderConnection are bypassable", () => {
    expect(MODELS_TENANT_BYPASSABLE.has("ExchangeRate")).toBe(true);
    expect(MODELS_TENANT_BYPASSABLE.has("ProviderConnection")).toBe(true);
  });

  it("parallel TENANT contexts stay isolated", async () => {
    const ctxA: TenantContext = {
      kind: "TENANT",
      clinicId: "clinic_A",
      userId: "uA",
      role: "ADMIN",
    };
    const ctxB: TenantContext = {
      kind: "TENANT",
      clinicId: "clinic_B",
      userId: "uB",
      role: "DOCTOR",
    };

    const [a, b] = await Promise.all([
      runWithTenant(ctxA, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getClinicId();
      }),
      runWithTenant(ctxB, async () => {
        await new Promise((r) => setTimeout(r, 3));
        return getClinicId();
      }),
    ]);

    expect(a).toBe("clinic_A");
    expect(b).toBe("clinic_B");
  });

  it("SUPER_ADMIN context returns null clinicId and no TENANT marker", async () => {
    await runWithTenant({ kind: "SUPER_ADMIN", userId: "root" }, async () => {
      expect(getClinicId()).toBeNull();
      expect(getTenant()?.kind).toBe("SUPER_ADMIN");
    });
  });

  it("SYSTEM context returns null clinicId", async () => {
    await runWithTenant({ kind: "SYSTEM" }, async () => {
      expect(getClinicId()).toBeNull();
    });
  });

  // TODO(phase-7): integration test — seed 2 clinics, query Patient under
  // TENANT-A and assert TENANT-B patients are not returned. Requires test DB.
});
