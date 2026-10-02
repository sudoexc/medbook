/**
 * Audit SEC-08: the SUPER_ADMIN seat is mandatory-2FA in security-policy.ts,
 * but nothing on the control plane checked it. /admin looked at the role
 * only, every /api/platform and /api/admin handler did the same, and the CRM
 * API wrapper skipped the check for an impersonating SUPER_ADMIN on the
 * promise of a grant-layer 2FA that never existed. A leaked password alone
 * reset clinic owners' passwords and entered clinics in WRITE mode.
 *
 * Pinned here (the card's acceptance):
 *   - a SUPER_ADMIN without `totpEnabledAt` is sent to the enrolment page
 *     from /admin (never locked out: the page is reachable and works);
 *   - /api/platform/* (both wrappers), /api/admin/* and entering a clinic via
 *     /api/platform/session/switch-clinic answer 403 MFA_REQUIRED;
 *   - an impersonated CRM request needs the SUPER_ADMIN's own 2FA;
 *   - leaving a clinic stays open, and an enrolled SUPER_ADMIN passes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionUser = {
  id: string;
  role: string;
  clinicId: string | null;
  name?: string | null;
  email?: string | null;
  impersonation?: { grantId: string; mode: "WRITE" | "VIEW_ONLY" } | null;
};

const h = vi.hoisted(() => ({
  session: null as { user: SessionUser } | null,
  userRow: null as {
    totpEnabledAt: Date | null;
    clinic: { require2faForAll: boolean } | null;
  } | null,
  userLookups: 0,
  grantsCreated: 0,
  audits: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => {
        h.userLookups++;
        return h.userRow;
      }),
    },
    clinic: {
      findUnique: vi.fn(async () => ({ id: "c1", slug: "neurofax", nameRu: "N" })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        h.audits.push(data);
        return {};
      }),
    },
  },
}));
vi.mock("@/server/platform/impersonation", () => ({
  GRANT_COOKIE_NAME: "admin_grant_id",
  createGrant: vi.fn(async () => {
    h.grantsCreated++;
    return { grantId: "g1", expiresAt: new Date(Date.now() + 3600_000) };
  }),
  endGrant: vi.fn(async () => undefined),
  getActiveGrant: vi.fn(async () => null),
}));
vi.mock("@/server/platform/clinic-override", () => ({
  OVERRIDE_COOKIE_NAME: "admin_clinic_override",
  signClinicOverride: () => "signed",
}));

import {
  createPlatformHandler,
  createPlatformListHandler,
  requireSuperAdmin,
} from "@/server/platform/handler";
import { createApiListHandler } from "@/lib/api-handler";
import {
  SUPER_ADMIN_ENROL_PATH,
  adminPageAccess,
} from "@/server/platform/admin-page-gate";
import { owesTotpEnrolment } from "@/server/auth/mfa-gate";
import { POST as switchClinic } from "@/app/api/platform/session/switch-clinic/route";

const SUPER: SessionUser = { id: "su1", role: "SUPER_ADMIN", clinicId: null };
const NOT_ENROLLED = { totpEnabledAt: null, clinic: null };
const ENROLLED = { totpEnabledAt: new Date("2026-09-01T00:00:00Z"), clinic: null };

let prevDisable: string | undefined;
beforeEach(() => {
  // vitest.config.ts sets DISABLE_2FA=1 for the route suites; this one is
  // about the enforcement itself.
  prevDisable = process.env.DISABLE_2FA;
  delete process.env.DISABLE_2FA;
  h.session = { user: { ...SUPER } };
  h.userRow = NOT_ENROLLED;
  h.userLookups = 0;
  h.grantsCreated = 0;
  h.audits = [];
});
afterEach(() => {
  if (prevDisable === undefined) delete process.env.DISABLE_2FA;
  else process.env.DISABLE_2FA = prevDisable;
});

async function errorOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: string }).error;
}

describe("owesTotpEnrolment", () => {
  it("is true for a SUPER_ADMIN without 2FA and false once enrolled", async () => {
    expect(await owesTotpEnrolment("su1", "SUPER_ADMIN")).toBe(true);
    h.userRow = ENROLLED;
    expect(await owesTotpEnrolment("su1", "SUPER_ADMIN")).toBe(false);
  });

  it("fails closed when the account row is gone", async () => {
    h.userRow = null;
    expect(await owesTotpEnrolment("gone", "SUPER_ADMIN")).toBe(true);
  });

  it("respects the global DISABLE_2FA kill-switch without a lookup", async () => {
    process.env.DISABLE_2FA = "1";
    expect(await owesTotpEnrolment("su1", "SUPER_ADMIN")).toBe(false);
    expect(h.userLookups).toBe(0);
  });

  it("leaves a doctor of a clinic without «2FA for everyone» alone", async () => {
    h.userRow = { totpEnabledAt: null, clinic: { require2faForAll: false } };
    expect(await owesTotpEnrolment("d1", "DOCTOR")).toBe(false);
  });
});

describe("requireSuperAdmin (every /api/platform and /api/admin route)", () => {
  it("answers 403 MFA_REQUIRED to a SUPER_ADMIN without 2FA", async () => {
    const gate = await requireSuperAdmin();
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(403);
      expect(await errorOf(gate.response)).toBe("MFA_REQUIRED");
    }
  });

  it("lets an enrolled SUPER_ADMIN through", async () => {
    h.userRow = ENROLLED;
    await expect(requireSuperAdmin()).resolves.toEqual({ ok: true, userId: "su1" });
  });

  it("keeps 401 for no session and 403 Forbidden for other roles", async () => {
    h.session = null;
    const anon = await requireSuperAdmin();
    expect(!anon.ok && anon.response.status).toBe(401);

    h.session = { user: { id: "a1", role: "ADMIN", clinicId: "c1" } };
    const admin = await requireSuperAdmin();
    expect(!admin.ok && (await errorOf(admin.response))).toBe("Forbidden");
  });

  it("{ mfa: false } checks the role only", async () => {
    await expect(requireSuperAdmin({ mfa: false })).resolves.toEqual({
      ok: true,
      userId: "su1",
    });
    expect(h.userLookups).toBe(0);
  });

  it("gates both platform wrappers before the handler runs", async () => {
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const list = createPlatformListHandler(inner);
    const mutate = createPlatformHandler({}, inner);
    const req = () => new Request("https://neurofax.uz/api/platform/clinics");

    for (const handler of [list, mutate]) {
      const res = await handler(req());
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toBe("MFA_REQUIRED");
    }
    expect(inner).not.toHaveBeenCalled();

    h.userRow = ENROLLED;
    expect((await list(req())).status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("no /api/platform or /api/admin route keeps a role-only copy of the gate", () => {
    const root = path.resolve(__dirname, "../../src/app/api");
    const files = [
      "admin/plans/route.ts",
      "admin/encryption-health/route.ts",
      "admin/clinics/[id]/lifecycle/route.ts",
      "admin/clinics/[id]/subscription/route.ts",
      "admin/clinics/[id]/subscription/cancel/route.ts",
      "admin/clinics/[id]/subscription/extend-trial/route.ts",
      "platform/integrations/[id]/route.ts",
      "platform/clinics/[id]/route.ts",
      "platform/clinics/[id]/integrations/route.ts",
      "platform/users/[id]/route.ts",
      "platform/session/switch-clinic/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src, f).toMatch(/requireSuperAdmin\(/);
      expect(src, f).not.toMatch(/async function requireSuper\(/);
      expect(src, f).not.toMatch(/role !== "SUPER_ADMIN"\) return err\("Forbidden"/);
    }
  });
});

describe("switch-clinic", () => {
  const post = (clinicId: string | null) =>
    new Request("https://neurofax.uz/api/platform/session/switch-clinic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        clinicId ? { clinicId, reason: "support ticket", mode: "WRITE" } : { clinicId: null },
      ),
    });

  it("refuses to enter a clinic without the SUPER_ADMIN's 2FA", async () => {
    const res = await switchClinic(post("c1"));
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("MFA_REQUIRED");
    expect(h.grantsCreated).toBe(0);
  });

  it("enters once enrolled", async () => {
    h.userRow = ENROLLED;
    const res = await switchClinic(post("c1"));
    expect(res.status).toBe(200);
    expect(h.grantsCreated).toBe(1);
  });

  it("always lets a SUPER_ADMIN leave a clinic", async () => {
    const res = await switchClinic(post(null));
    expect(res.status).toBe(200);
    expect(h.grantsCreated).toBe(0);
  });
});

describe("impersonated CRM requests", () => {
  const impersonating: SessionUser = {
    ...SUPER,
    clinicId: "c1",
    impersonation: { grantId: "g1", mode: "WRITE" },
  };

  it("need the SUPER_ADMIN's own 2FA (no more impersonation skip)", async () => {
    h.session = { user: impersonating };
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const handler = createApiListHandler({ roles: ["ADMIN"] }, inner);
    const res = await handler(new Request("https://neurofax.uz/api/crm/patients"));
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("MFA_REQUIRED");
    expect(inner).not.toHaveBeenCalled();

    h.userRow = ENROLLED;
    const ok = await handler(new Request("https://neurofax.uz/api/crm/patients"));
    expect(ok.status).toBe(200);
  });

  it("a SUPER_ADMIN without a clinic on a CRM list route is gated too", async () => {
    // Audit PT-05: refused before the 2FA check, like createApiHandler does,
    // because it may not read a clinic's data at all without a grant.
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const handler = createApiListHandler({}, inner);
    const res = await handler(new Request("https://neurofax.uz/api/crm/notifications"));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("ClinicNotSelected");
    expect(inner).not.toHaveBeenCalled();
  });

  it("the enrolment endpoints stay reachable", async () => {
    h.session = { user: impersonating };
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const handler = createApiListHandler({}, inner);
    const res = await handler(new Request("https://neurofax.uz/api/crm/auth/totp-required"));
    expect(res.status).toBe(200);
  });
});

describe("/admin pages", () => {
  it("send a SUPER_ADMIN without 2FA to the enrolment page, not a lockout", async () => {
    await expect(adminPageAccess()).resolves.toEqual({ kind: "owes_mfa" });
    // The CRM security page: the proxy exempts it from its own redirect and
    // the TOTP endpoints use the plain session, so a SUPER_ADMIN without a
    // clinic can enrol there.
    expect(SUPER_ADMIN_ENROL_PATH).toBe("/crm/me/security");
  });

  it("let an enrolled SUPER_ADMIN in and keep other roles out", async () => {
    h.userRow = ENROLLED;
    h.session = { user: { ...SUPER, name: "Root", email: "root@x.uz" } };
    await expect(adminPageAccess()).resolves.toEqual({
      kind: "ok",
      userId: "su1",
      name: "Root",
      email: "root@x.uz",
      clinicId: null,
    });
    h.session = { user: { id: "a1", role: "ADMIN", clinicId: "c1" } };
    await expect(adminPageAccess()).resolves.toEqual({ kind: "forbidden" });
  });

  it("the layout and the server-loading billing page both use the gate", () => {
    const read = (f: string) =>
      readFileSync(path.resolve(__dirname, "../../src/app/admin", f), "utf8");
    for (const f of ["layout.tsx", "clinics/[id]/billing/page.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/adminPageAccess\(\)/);
      expect(src, f).toMatch(/redirect\(SUPER_ADMIN_ENROL_PATH\)/);
    }
  });
});
