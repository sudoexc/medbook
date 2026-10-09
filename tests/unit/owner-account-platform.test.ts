/**
 * Owner account P0, platform routes (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §2 and §7 P0):
 *   - POST /api/platform/session/extend gives the caller's own live grant a
 *     fresh 60 minutes, never past 8 h from its start, journals
 *     SUPER_ADMIN_IMPERSONATE_EXTENDED and re-sets both cookies;
 *   - POST /api/platform/session/switch-clinic enters a switched-off clinic
 *     only with `breakGlass: true` and marks the STARTED row.
 *
 * The real platform handler and grant helpers run against a mocked Prisma.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type GrantRow = {
  id: string;
  superAdminId: string;
  clinicId: string;
  reason: string;
  mode: "WRITE" | "VIEW_ONLY";
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
};

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; clinicId: string | null } },
  clinic: null as null | { id: string; slug: string; nameRu: string; active: boolean },
  grants: new Map<string, GrantRow>(),
  created: 0,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => h.session) }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
  runUnscoped: <T,>(_r: string, fn: () => T) => fn(),
}));
vi.mock("@/server/auth/mfa-gate", () => ({
  owesTotpEnrolment: vi.fn(async () => false),
  mfaRequiredResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("@/server/platform/clinic-override", () => ({
  OVERRIDE_COOKIE_NAME: "admin_clinic_override",
  signClinicOverride: (id: string) => `signed:${id}`,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findUnique: vi.fn(async () => h.clinic) },
    impersonationGrant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = h.grants.get(where.id);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<GrantRow, "id" | "startedAt" | "endedAt" | "endedReason"> }) => {
        h.created += 1;
        const row: GrantRow = {
          ...data,
          id: `gNew${h.created}`,
          startedAt: new Date(),
          endedAt: null,
          endedReason: null,
        };
        h.grants.set(row.id, row);
        return { id: row.id, expiresAt: row.expiresAt };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; superAdminId?: string; endedAt?: null; expiresAt?: { gt: Date } };
          data: Partial<GrantRow>;
        }) => {
          const row = h.grants.get(where.id);
          if (!row) return { count: 0 };
          if (where.endedAt === null && row.endedAt !== null) return { count: 0 };
          if (where.superAdminId && row.superAdminId !== where.superAdminId) return { count: 0 };
          if (where.expiresAt && !(row.expiresAt > where.expiresAt.gt)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push(data);
        return {};
      }),
    },
  },
}));

import { POST as extend } from "@/app/api/platform/session/extend/route";
import { POST as switchClinic } from "@/app/api/platform/session/switch-clinic/route";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  IMPERSONATION_LEASE_MS,
  IMPERSONATION_MAX_MS,
} from "@/server/platform/impersonation";

const MIN = 60_000;
const NOW = new Date("2026-10-09T09:00:00.000Z");

function grant(over: Partial<GrantRow> = {}): GrantRow {
  return {
    id: "gA",
    superAdminId: "sa1",
    clinicId: "cA",
    reason: "support ticket",
    mode: "VIEW_ONLY",
    startedAt: new Date(NOW.getTime() - 57 * MIN),
    expiresAt: new Date(NOW.getTime() + 3 * MIN),
    endedAt: null,
    endedReason: null,
    ...over,
  };
}

function post(url: string, body?: unknown, cookie = "admin_grant_id=gA"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const EXTEND = "https://crm.test/api/platform/session/extend";
const SWITCH = "https://crm.test/api/platform/session/switch-clinic";

const audited = (action: string) => h.audits.filter((a) => a.action === action);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.session = { user: { id: "sa1", role: "SUPER_ADMIN", clinicId: "cA" } };
  h.clinic = { id: "cA", slug: "alpha", nameRu: "Альфа", active: true };
  h.grants.clear();
  h.created = 0;
  h.audits = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/platform/session/extend", () => {
  it("gives a fresh 60 minutes, journals it and re-sets both cookies", async () => {
    h.grants.set("gA", grant());
    const res = await extend(post(EXTEND));
    expect(res.status).toBe(200);
    const expected = new Date(NOW.getTime() + IMPERSONATION_LEASE_MS);
    expect(await res.json()).toMatchObject({
      ok: true,
      grantId: "gA",
      mode: "VIEW_ONLY",
      expiresAt: expected.toISOString(),
    });
    expect(h.grants.get("gA")!.expiresAt).toEqual(expected);

    const rows = audited(AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXTENDED);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      clinicId: "cA",
      actorId: "sa1",
      actorRole: "SUPER_ADMIN",
      entityType: "ImpersonationGrant",
      entityId: "gA",
      meta: {
        clinicId: "cA",
        mode: "VIEW_ONLY",
        previousExpiresAt: new Date(NOW.getTime() + 3 * MIN).toISOString(),
        expiresAt: expected.toISOString(),
      },
    });

    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^admin_clinic_override=signed:cA; .*Max-Age=3600$/);
    expect(cookies[1]).toMatch(/^admin_grant_id=gA; .*Max-Age=3600$/);
  });

  it("never goes past 8 hours from the start of the grant", async () => {
    const startedAt = new Date(NOW.getTime() - 7.5 * 60 * MIN);
    h.grants.set("gA", grant({ startedAt }));
    const res = await extend(post(EXTEND));
    expect(res.status).toBe(200);
    const cap = new Date(startedAt.getTime() + IMPERSONATION_MAX_MS);
    expect(await res.json()).toMatchObject({
      expiresAt: cap.toISOString(),
      maxExpiresAt: cap.toISOString(),
    });
    expect(h.grants.get("gA")!.expiresAt).toEqual(cap);
    // The cookies end with the capped lease: 30 minutes, not 60.
    expect(res.headers.getSetCookie()[1]).toMatch(/Max-Age=1800$/);
  });

  it("at the cap answers 409 and changes nothing", async () => {
    const startedAt = new Date(NOW.getTime() - IMPERSONATION_MAX_MS + 2 * MIN);
    const atCap = new Date(startedAt.getTime() + IMPERSONATION_MAX_MS);
    h.grants.set("gA", grant({ startedAt, expiresAt: atCap }));
    const res = await extend(post(EXTEND));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "lease_cap_reached" });
    expect(h.grants.get("gA")!.expiresAt).toEqual(atCap);
    expect(audited(AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXTENDED)).toHaveLength(0);
  });

  it("refuses a grant of another admin, an ended one and a missing cookie", async () => {
    h.grants.set("gA", grant({ superAdminId: "sa2" }));
    let res = await extend(post(EXTEND));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "no_live_grant" });
    expect(h.grants.get("gA")!.expiresAt).toEqual(new Date(NOW.getTime() + 3 * MIN));

    h.grants.set("gA", grant({ endedAt: new Date(NOW.getTime() - MIN), endedReason: "user_exit" }));
    res = await extend(post(EXTEND));
    expect(res.status).toBe(409);

    h.grants.set("gA", grant({ expiresAt: new Date(NOW.getTime() - 1000) }));
    res = await extend(post(EXTEND));
    expect(res.status).toBe(409);

    res = await extend(post(EXTEND, undefined, ""));
    expect(res.status).toBe(409);
    expect(audited(AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXTENDED)).toHaveLength(0);
  });

  it("is for the SUPER_ADMIN only", async () => {
    h.grants.set("gA", grant());
    h.session = { user: { id: "a1", role: "ADMIN", clinicId: "cA" } };
    expect((await extend(post(EXTEND))).status).toBe(403);
    h.session = null;
    expect((await extend(post(EXTEND))).status).toBe(401);
  });
});

describe("POST /api/platform/session/switch-clinic: a switched-off clinic", () => {
  const entry = { clinicId: "cOff", reason: "проверка жалобы", mode: "VIEW_ONLY" };
  const started = () => audited(AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_STARTED);

  beforeEach(() => {
    h.session = { user: { id: "sa1", role: "SUPER_ADMIN", clinicId: null } };
    h.clinic = { id: "cOff", slug: "off", nameRu: "Выключенная", active: false };
  });

  it("needs breakGlass: without it 409 and no grant", async () => {
    const res = await switchClinic(post(SWITCH, entry, ""));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "clinic_inactive" });
    expect(h.created).toBe(0);
    expect(started()).toHaveLength(0);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("with breakGlass enters and marks the journal row", async () => {
    const res = await switchClinic(post(SWITCH, { ...entry, breakGlass: true }, ""));
    expect(res.status).toBe(200);
    expect(h.created).toBe(1);
    expect(started()).toHaveLength(1);
    expect(started()[0]).toMatchObject({
      clinicId: "cOff",
      meta: { clinicId: "cOff", mode: "VIEW_ONLY", inactiveClinic: true },
    });
    const cookies = res.headers.getSetCookie();
    expect(cookies[0]).toMatch(/^admin_clinic_override=signed:cOff;/);
    expect(cookies[1]).toMatch(/^admin_grant_id=gNew1;/);
  });

  it("an active clinic needs no flag and is not marked", async () => {
    h.clinic = { id: "cA", slug: "alpha", nameRu: "Альфа", active: true };
    const res = await switchClinic(post(SWITCH, { ...entry, clinicId: "cA" }, ""));
    expect(res.status).toBe(200);
    expect(started()[0]!.meta).not.toHaveProperty("inactiveClinic");
  });
});
