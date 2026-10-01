/**
 * Audit PT-05: a SUPER_ADMIN with no clinic read every clinic's patients
 * through the GET wrapper (`createApiListHandler`), with no impersonation
 * grant, no reason and no PatientView row: the Prisma tenant extension adds
 * no clinicId for a SUPER_ADMIN context. The mutating wrapper already
 * refused that context; now the read wrapper does too.
 *
 * Acceptance: GET /api/crm/patients under a SUPER_ADMIN without an active
 * grant answers 400 ClinicNotSelected, and the handler never runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  session: null as null | {
    user: {
      id: string;
      role: string;
      clinicId: string | null;
      impersonation?: { grantId: string; mode: "WRITE" | "VIEW_ONLY" } | null;
    };
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { createApiListHandler } from "@/lib/api-handler";

const req = (path: string) => new Request(`https://neurofax.uz${path}`);

beforeEach(() => {
  h.session = null;
});

describe("createApiListHandler and a SUPER_ADMIN", () => {
  it("refuses a SUPER_ADMIN without a clinic before the handler runs", async () => {
    h.session = { user: { id: "su1", role: "SUPER_ADMIN", clinicId: null } };
    const inner = vi.fn(async () => Response.json({ rows: [] }));
    for (const path of [
      "/api/crm/patients",
      "/api/crm/patients/export",
      "/api/crm/patients/p1",
      "/api/crm/cases/c1",
    ]) {
      const res = await createApiListHandler({ roles: ["ADMIN"] }, inner)(req(path));
      expect(res.status, path).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("ClinicNotSelected");
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it("lets an impersonating SUPER_ADMIN read as a tenant of that clinic", async () => {
    h.session = {
      user: {
        id: "su1",
        role: "SUPER_ADMIN",
        clinicId: "c1",
        impersonation: { grantId: "g1", mode: "VIEW_ONLY" },
      },
    };
    const inner = vi.fn(async ({ ctx }: { ctx: { kind: string; clinicId?: string } }) =>
      Response.json({ kind: ctx.kind, clinicId: ctx.clinicId }),
    );
    const res = await createApiListHandler({ roles: ["ADMIN"] }, inner)(req("/api/crm/patients"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "TENANT", clinicId: "c1" });
  });

  it("clinic staff are unaffected", async () => {
    h.session = { user: { id: "a1", role: "ADMIN", clinicId: "c1" } };
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const res = await createApiListHandler({ roles: ["ADMIN"] }, inner)(req("/api/crm/patients"));
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
