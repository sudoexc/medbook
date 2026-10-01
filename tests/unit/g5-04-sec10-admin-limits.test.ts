/**
 * Audit G5-04 (/admin/users and /admin/audit crashed on load: Radix Select
 * throws on `<SelectItem value="">`; users were capped at the first 50) and
 * SEC-10 (plan limits never enforced; a switched-off clinic's staff kept
 * signing in).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SELECT_ALL,
  SELECT_NONE,
  fromSelectValue,
  toSelectValue,
} from "@/lib/select-sentinel";
import { clinicLocksOut } from "@/server/auth/clinic-access";
import { decideStaffSession } from "@/server/auth/session-guard";
import { readPlanLimit } from "@/lib/plan-limit";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// ── G5-04 ────────────────────────────────────────────────────────────────

describe("G5-04: no empty SelectItem value on the platform pages", () => {
  it("«Все …» and «без клиники» are sentinels mapped to an empty filter", () => {
    expect(toSelectValue("")).toBe(SELECT_ALL);
    expect(toSelectValue("", SELECT_NONE)).toBe(SELECT_NONE);
    expect(toSelectValue("c1")).toBe("c1");
    expect(fromSelectValue(SELECT_ALL)).toBe("");
    expect(fromSelectValue(SELECT_NONE)).toBe("");
    expect(fromSelectValue("DOCTOR")).toBe("DOCTOR");
  });

  it('nothing under src/app/admin renders <SelectItem value="">', () => {
    for (const f of walk(path.join(root, "src/app/admin"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/<SelectItem\s+value=""/);
    }
  });

  it("the users page asks for the next page with the API's cursor", () => {
    const src = read("src/app/admin/users/_components/users-page-client.tsx");
    expect(src).toContain('params.set("cursor", cursor)');
    expect(src).toContain("useInfiniteQuery");
    expect(src).toContain("users.fetchNextPage()");
  });
});

// ── SEC-10: Clinic.active ────────────────────────────────────────────────

const NOW = new Date("2026-10-01T07:00:00.000Z");
const guardUser = (over: Record<string, unknown>) => ({
  id: "u1",
  active: true,
  role: "RECEPTIONIST",
  clinicId: "c1",
  mustChangePassword: false,
  lastSessionRotatedAt: NOW,
  idleTimeoutMinutes: null,
  clinicActive: true,
  ...over,
}) as Parameters<typeof decideStaffSession>[0]["user"];

describe("SEC-10: a switched-off clinic locks its staff out", () => {
  it("staff of an inactive clinic are locked out; SUPER_ADMIN never is", () => {
    expect(clinicLocksOut({ role: "ADMIN", clinicId: "c1", clinicActive: false })).toBe(true);
    expect(clinicLocksOut({ role: "ADMIN", clinicId: "c1", clinicActive: true })).toBe(false);
    expect(clinicLocksOut({ role: "SUPER_ADMIN", clinicId: null, clinicActive: false })).toBe(false);
    expect(clinicLocksOut({ role: "DOCTOR", clinicId: "c1", clinicActive: null })).toBe(false);
  });

  it("an open session ends at the next request", () => {
    const claims = { userId: "u1", role: "RECEPTIONIST" as const, clinicId: "c1" };
    const v = decideStaffSession({
      claims,
      binding: { kind: "unbound" },
      row: null,
      user: guardUser({ clinicActive: false }),
      now: NOW,
    });
    expect(v).toMatchObject({ ok: false, reason: "clinic-inactive" });
    expect(
      decideStaffSession({
        claims,
        binding: { kind: "unbound" },
        row: null,
        user: guardUser({}),
        now: NOW,
      }).ok,
    ).toBe(true);
  });

  it("the sign-in itself refuses, and the session guard reads Clinic.active", () => {
    const auth = read("src/lib/auth.ts");
    expect(auth).toContain("include: { clinic: { select: { active: true } } }");
    expect(auth).toContain("clinicLocksOut(");
    expect(read("src/server/auth/session-guard.ts")).toContain(
      "clinic: { select: { sessionIdleTimeoutMinutes: true, active: true } }",
    );
  });
});

const pre = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
}));

vi.mock("@/server/auth/login-throttle", () => ({
  beginLoginAttempt: vi.fn(async () => ({
    blocked: false,
    release: () => undefined,
    succeeded: () => undefined,
  })),
  tooManyAttemptsResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/server/auth/login-sources", () => ({ isKnownLoginSource: async () => true }));
vi.mock("@/server/auth/password", () => ({
  verifyPasswordConstantTime: async () => true,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, get: () => undefined }),
}));

// ── SEC-10: plan limits ──────────────────────────────────────────────────

const lim = vi.hoisted(() => ({
  sub: null as null | { status: string; plan: { slug: string; features: unknown } },
  patients: 0,
  appointments: 0,
  counted: 0,
  audits: [] as string[],
  fail: false,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: async (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => pre.user) },
    subscription: {
      findUnique: vi.fn(async () => {
        if (lim.fail) throw new Error("db down");
        return lim.sub;
      }),
    },
    patient: {
      count: vi.fn(async () => {
        lim.counted += 1;
        return lim.patients;
      }),
    },
    appointment: {
      count: vi.fn(async () => {
        lim.counted += 1;
        return lim.appointments;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string } }) => {
        lim.audits.push(data.action);
        return data;
      }),
    },
  },
}));

beforeEach(() => {
  lim.sub = { status: "TRIAL", plan: { slug: "basic", features: { maxPatients: 50, maxAppointmentsPerMonth: 100 } } };
  lim.patients = 0;
  lim.appointments = 0;
  lim.counted = 0;
  lim.audits = [];
  lim.fail = false;
  pre.user = null;
});

describe("SEC-10: the login pre-flight says the clinic is switched off", () => {
  it("right password, inactive clinic: 403 clinic_inactive", async () => {
    pre.user = {
      id: "u1",
      passwordHash: "h",
      active: true,
      totpEnabledAt: null,
      role: "RECEPTIONIST",
      clinicId: "c1",
      clinic: { active: false },
    };
    const { POST } = await import("@/app/api/crm/auth/totp-required/route");
    const res = await POST(
      new Request("https://x/api/crm/auth/totp-required", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "r@x.uz", password: "secret" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe("clinic_inactive");
    expect(read("src/app/login/page.tsx")).toContain('t("clinicInactive")');
  });
});

describe("SEC-10: plan limits are enforced", () => {
  it("the 51st patient on Basic gets a clear 402", async () => {
    lim.patients = 50;
    const { ensureQuotaForApi } = await import("@/server/billing/plan-limits");
    const res = await ensureQuotaForApi("c1", "maxPatients");
    expect(res?.status).toBe(402);
    const body = (await res!.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "PlanLimitExceeded", quota: "maxPatients", max: 50, current: 50 });
    expect(lim.audits).toEqual(["PLAN_LIMIT_BLOCKED"]);
    expect(readPlanLimit(402, body)).toEqual({ quota: "maxPatients", max: 50 });
  });

  it("below the limit, or on a paying plan, nothing is blocked (and a paying plan is not even counted)", async () => {
    const { ensureQuotaForApi } = await import("@/server/billing/plan-limits");
    lim.patients = 49;
    expect(await ensureQuotaForApi("c1", "maxPatients")).toBeNull();
    lim.sub = { status: "ACTIVE", plan: { slug: "pro", features: { maxPatients: 500 } } };
    lim.patients = 10_000;
    lim.counted = 0;
    expect(await ensureQuotaForApi("c1", "maxPatients")).toBeNull();
    expect(lim.counted).toBe(0);
  });

  it("a cancelled subscription falls back to Basic limits", async () => {
    lim.sub = { status: "CANCELLED", plan: { slug: "pro", features: {} } };
    lim.appointments = 100;
    const { ensureQuotaForApi } = await import("@/server/billing/plan-limits");
    expect((await ensureQuotaForApi("c1", "maxAppointmentsPerMonth"))?.status).toBe(402);
  });

  it("a failing check lets the create through (the desk is never stopped by a hiccup)", async () => {
    lim.fail = true;
    const { ensureQuotaForApi } = await import("@/server/billing/plan-limits");
    expect(await ensureQuotaForApi("c1", "maxPatients")).toBeNull();
  });

  it("patient create, booking and walk-in call the guard; the dialogs word the 402", () => {
    expect(read("src/app/api/crm/patients/route.ts")).toContain(
      'ensureQuotaForApi(clinicId, "maxPatients")',
    );
    expect(read("src/app/api/crm/appointments/route.ts")).toContain('"maxAppointmentsPerMonth"');
    expect(read("src/app/api/crm/appointments/walkin/route.ts")).toContain("ensureQuotaForApi(");
    expect(read("src/app/[locale]/crm/patients/_components/new-patient-dialog.tsx")).toContain(
      "readPlanLimit(res.status, err)",
    );
    expect(read("src/components/appointments/NewAppointmentDialog.tsx")).toContain("readPlanLimit(");
  });
});
