/**
 * Audit P6 C8 — the platform panel's routes:
 *   G5-05 clinic GET/PATCH/DELETE never return the bot token, webhook secret
 *         or kiosk PIN;
 *   G5-06 «Переназначить» keeps the CRM's last-admin and doctor-card rules;
 *   G5-07 «Пароль владельца» lists the ADMIN accounts and resets the one picked;
 *   G5-09 entering clinic B journals the end of clinic A, «Выйти» with nothing
 *         live journals nothing;
 *   G5-10 the clinic audit row has the values before and after;
 *   G5-12 «Здоровье» reports what the live checks found;
 *   G5-13 «Использование» counts Telegram traffic, not in-app replies;
 *   G5-15 «Шифрование» audits a look once per window, one scan per column.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  clinicRow: null as null | Record<string, unknown>,
  clinicSelects: [] as unknown[],
  clinicUpdates: [] as Array<{ data: Record<string, unknown>; select?: unknown }>,
  user: null as null | Record<string, unknown>,
  userUpdates: [] as Array<{ data: Record<string, unknown> }>,
  otherAdmins: 0,
  card: null as null | { id: string; clinicId: string },
  cardReleases: [] as unknown[],
  admins: [] as Array<{ id: string; name: string | null; email: string }>,
  passwordFor: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  auditRows: [] as Array<Record<string, unknown>>,
  recentAudit: null as null | { id: string },
  grant: null as null | Record<string, unknown>,
  endGrantCalls: [] as Array<[string, string]>,
  messageWheres: [] as Array<Record<string, unknown>>,
  notifWhere: null as null | Record<string, unknown>,
  rawQueries: [] as string[],
  checks: {} as Record<string, { status: string; latencyMs?: number; details?: string }>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/platform/handler", () => {
  const userId = "sa1";
  return {
    requireSuperAdmin: vi.fn(async () => ({ ok: true, userId })),
    platformAudit: vi.fn(async (input: Record<string, unknown>) => {
      h.audits.push(input);
    }),
    createPlatformHandler:
      (_o: unknown, fn: (a: { request: Request; body: unknown; userId: string }) => Promise<Response>) =>
      (request: Request) =>
        fn({ request, body: undefined, userId }),
    createPlatformListHandler:
      (fn: (a: { request: Request; userId: string }) => Promise<Response>) =>
      (request: Request) =>
        fn({ request, userId }),
    idFromUrl: (request: Request, position = 4) =>
      new URL(request.url).pathname.split("/").filter(Boolean)[position] ?? null,
  };
});
vi.mock("@/server/auth/session-guard", () => ({
  revokeUserSessions: vi.fn(async () => 1),
  invalidateSessionGuardCache: vi.fn(),
}));
vi.mock("@/server/auth/password", () => ({
  generateTempPassword: () => "Temp-Pass-123",
  hashPassword: async () => "hashed",
}));
vi.mock("@/server/auth/mfa-gate", () => ({
  owesTotpEnrolment: vi.fn(async () => false),
  mfaRequiredResponse: () => new Response(null, { status: 403 }),
}));
vi.mock("@/server/platform/clinic-override", () => ({
  OVERRIDE_COOKIE_NAME: "admin_clinic_override",
  signClinicOverride: () => "signed",
}));
vi.mock("@/server/platform/impersonation", () => ({
  GRANT_COOKIE_NAME: "admin_grant_id",
  createGrant: vi.fn(async () => ({ grantId: "gB", expiresAt: new Date(Date.now() + 3600_000) })),
  endGrant: vi.fn(async (id: string, reason: string) => {
    h.endGrantCalls.push([id, reason]);
    return true;
  }),
  getActiveGrant: vi.fn(async () => h.grant),
}));
vi.mock("@/server/observability/service-checks", () => ({
  checkDb: async () => h.checks.db,
  checkRedis: async () => h.checks.redis,
  checkMinio: async () => h.checks.minio,
}));
vi.mock("@/server/observability/worker-health", () => ({
  checkWorkerHealth: async () => h.checks.workers,
}));
vi.mock("@/server/crypto/field-cipher", () => ({
  encryptField: (v: string) => `v1:${v}`,
  decryptField: (v: string) => v.slice(3),
  getActiveKeyVersion: () => "v1",
  getKnownKeyVersions: () => ["v1"],
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    clinic: {
      findUnique: vi.fn(async (args: { select?: unknown }) => {
        h.clinicSelects.push(args.select);
        return h.clinicRow;
      }),
      findMany: vi.fn(async () => [
        { id: "c1", slug: "alpha", nameRu: "Альфа", nameUz: "Alfa", active: true },
      ]),
      update: vi.fn(async (args: { data: Record<string, unknown>; select?: unknown }) => {
        h.clinicUpdates.push(args);
        return { ...h.clinicRow, ...args.data };
      }),
    },
    user: {
      findUnique: vi.fn(async () => h.user),
      findMany: vi.fn(async () => h.admins),
      count: vi.fn(async () => h.otherAdmins),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        h.userUpdates.push(args);
        if ("passwordHash" in args.data) h.passwordFor.push(args.where.id);
        return { ...h.user, ...args.data };
      }),
    },
    doctor: {
      findFirst: vi.fn(async () => h.card),
      updateMany: vi.fn(async (args: unknown) => {
        h.cardReleases.push(args);
        return { count: 1 };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    auditLog: {
      findFirst: vi.fn(async () => h.recentAudit),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.auditRows.push(data);
        return {};
      }),
    },
    appointment: { groupBy: vi.fn(async () => []) },
    call: { groupBy: vi.fn(async () => []) },
    patient: { groupBy: vi.fn(async () => []) },
    message: {
      groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        h.messageWheres.push(where);
        const channel = (where.conversation as { channel: string }).channel;
        return [{ clinicId: "c1", _count: { _all: channel === "TG" ? 4 : 9 } }];
      }),
    },
    notificationSend: {
      groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.channel === "SMS") return [];
        h.notifWhere = where;
        return [
          { clinicId: "c1", channel: "TG", _count: { _all: 100 } },
          { clinicId: "c1", channel: "INAPP", _count: { _all: 7 } },
        ];
      }),
    },
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      h.rawQueries.push(sql);
      return [
        { prefix: "__null__", n: 3 },
        { prefix: "__plain__", n: 2 },
        { prefix: "v1", n: 10 },
      ];
    }),
  };
  return { prisma };
});

import * as clinicRoute from "@/app/api/platform/clinics/[id]/route";
import { PATCH as patchUser } from "@/app/api/platform/users/[id]/route";
import * as resetOwner from "@/app/api/platform/clinics/[id]/reset-owner-password/route";
import { POST as switchClinic } from "@/app/api/platform/session/switch-clinic/route";
import { GET as platformHealth } from "@/app/api/platform/health/route";
import { GET as usage } from "@/app/api/platform/usage/route";
import { GET as encryptionHealth } from "@/app/api/admin/encryption-health/route";
import { AUDIT_ACTION } from "@/lib/audit-actions";

const SECRETS = ["tgBotToken", "tgWebhookSecret", "kioskPin", "kioskTokenHash"];

beforeEach(() => {
  h.clinicRow = {
    id: "c1",
    slug: "neurofax",
    nameRu: "Нейрофакс",
    active: true,
    tgBotToken: "123:secret",
    tgWebhookSecret: "hook-secret",
    kioskPin: "1234",
  };
  h.clinicSelects = [];
  h.clinicUpdates = [];
  h.user = null;
  h.userUpdates = [];
  h.otherAdmins = 0;
  h.card = null;
  h.cardReleases = [];
  h.admins = [];
  h.passwordFor = [];
  h.audits = [];
  h.auditRows = [];
  h.recentAudit = null;
  h.grant = null;
  h.endGrantCalls = [];
  h.messageWheres = [];
  h.notifWhere = null;
  h.rawQueries = [];
});

function json(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", cookie: "admin_grant_id=gA" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("G5-05 / G5-10 /api/platform/clinics/[id]", () => {
  const url = "https://crm.test/api/platform/clinics/c1";

  it("reads, updates and deactivates through a select without credentials", async () => {
    await clinicRoute.GET(json(url, "GET"));
    await clinicRoute.PATCH(json(url, "PATCH", { active: false }));
    await clinicRoute.DELETE(json(url, "DELETE"));
    const selects = [...h.clinicSelects, ...h.clinicUpdates.map((u) => u.select)];
    expect(selects.length).toBeGreaterThanOrEqual(5);
    for (const select of selects) {
      expect(select).toBeTruthy();
      for (const key of SECRETS) expect(select).not.toHaveProperty(key);
      expect(select).toHaveProperty("active", true);
    }
  });

  it("audits active true → false, not only the field name", async () => {
    const res = await clinicRoute.PATCH(json(url, "PATCH", { active: false, nameRu: "Нейрофакс" }));
    expect(res.status).toBe(200);
    expect(h.audits[0]).toMatchObject({
      action: "clinic.update",
      meta: { changed: ["active"], before: { active: true }, after: { active: false } },
    });
  });
});

describe("G5-06 PATCH /api/platform/users/[id]", () => {
  const url = "https://crm.test/api/platform/users/u1";

  it("refuses to switch off, demote or move the clinic's last active ADMIN", async () => {
    h.user = { id: "u1", role: "ADMIN", active: true, clinicId: "c1" };
    for (const body of [{ active: false }, { role: "RECEPTIONIST" }, { clinicId: "c2" }]) {
      const res = await patchUser(json(url, "PATCH", body));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "last_admin" });
    }
    expect(h.userUpdates).toHaveLength(0);
  });

  it("lets it through while another active ADMIN remains", async () => {
    h.user = { id: "u1", role: "ADMIN", active: true, clinicId: "c1" };
    h.otherAdmins = 1;
    const res = await patchUser(json(url, "PATCH", { role: "RECEPTIONIST" }));
    expect(res.status).toBe(200);
    expect(h.audits[0]).toMatchObject({
      meta: { before: { role: "ADMIN" }, after: { role: "RECEPTIONIST" } },
    });
  });

  it("refuses to move an active doctor away from their doctor card", async () => {
    h.user = { id: "u1", role: "DOCTOR", active: true, clinicId: "c1" };
    h.card = { id: "d1", clinicId: "c1" };
    const res = await patchUser(json(url, "PATCH", { clinicId: "c2", role: "DOCTOR" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "doctor_card_bound" });
    expect(h.userUpdates).toHaveLength(0);
  });

  it("releases the card of a doctor switched off", async () => {
    h.user = { id: "u1", role: "DOCTOR", active: true, clinicId: "c1" };
    h.card = { id: "d1", clinicId: "c1" };
    const res = await patchUser(json(url, "PATCH", { active: false }));
    expect(res.status).toBe(200);
    expect(h.cardReleases).toEqual([
      { where: { id: "d1", userId: "u1" }, data: { userId: null } },
    ]);
    expect(h.audits[0]).toMatchObject({ meta: { doctorCard: { released: "d1" } } });
  });
});

describe("G5-07 reset-owner-password", () => {
  const url = "https://crm.test/api/platform/clinics/c1/reset-owner-password";
  beforeEach(() => {
    h.admins = [
      { id: "seed", name: "Демо админ", email: "demo@clinic.uz" },
      { id: "owner", name: "Владелец", email: "owner@clinic.uz" },
    ];
  });

  it("lists the active ADMIN accounts before anything is reset", async () => {
    const res = await resetOwner.GET(json(url, "GET"));
    expect(await res.json()).toEqual({ admins: h.admins });
    expect(h.passwordFor).toEqual([]);
  });

  it("resets the account picked, not the oldest one", async () => {
    const res = await resetOwner.POST(json(url, "POST", { userId: "owner" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ownerLogin: "owner@clinic.uz" });
    expect(h.passwordFor).toEqual(["owner"]);
  });

  it("refuses an account that is no active ADMIN of the clinic", async () => {
    const res = await resetOwner.POST(json(url, "POST", { userId: "stranger" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "owner_not_admin" });
    expect(h.passwordFor).toEqual([]);
  });

  it("still resets the oldest ADMIN on a call without a body", async () => {
    const res = await resetOwner.POST(json(url, "POST"));
    expect(res.status).toBe(200);
    expect(h.passwordFor).toEqual(["seed"]);
  });
});

describe("G5-09 switch-clinic journals the end of a live grant", () => {
  const url = "https://crm.test/api/platform/session/switch-clinic";
  const live = {
    id: "gA",
    superAdminId: "sa1",
    clinicId: "cA",
    mode: "WRITE",
    startedAt: new Date(Date.now() - 10 * 60_000),
    expiresAt: new Date(Date.now() + 50 * 60_000),
    reason: "support",
  };
  const ended = () =>
    h.audits.filter((a) => a.action === AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_ENDED);

  it("entering clinic B writes ENDED for clinic A", async () => {
    h.grant = live;
    const res = await switchClinic(json(url, "POST", { clinicId: "c1", reason: "next ticket" }));
    expect(res.status).toBe(200);
    expect(h.endGrantCalls).toEqual([["gA", "user_exit"]]);
    expect(ended()).toHaveLength(1);
    expect(ended()[0]).toMatchObject({ clinicId: "cA", entityId: "gA", meta: { via: "switch" } });
  });

  it("«Выйти» with nothing live writes no ENDED and does not stamp the grant", async () => {
    h.grant = null;
    const res = await switchClinic(json(url, "POST", { clinicId: null }));
    expect(res.status).toBe(200);
    expect(ended()).toHaveLength(0);
    expect(h.endGrantCalls).toEqual([]);
  });

  it("«Выйти» from a live grant writes ENDED with its clinic", async () => {
    h.grant = live;
    await switchClinic(json(url, "POST", { clinicId: null }));
    expect(ended()[0]).toMatchObject({ clinicId: "cA", meta: { via: "exit" } });
  });
});

describe("G5-12 /api/platform/health", () => {
  it("shows Redis DOWN and the stopped worker instead of env-based OK", async () => {
    h.checks = {
      db: { status: "ok", latencyMs: 2 },
      redis: { status: "down", latencyMs: 5000 },
      minio: { status: "ok", latencyMs: 3 },
      workers: { status: "down", processAgeSec: 600, staleLoops: [] } as never,
    };
    const res = await platformHealth(json("https://crm.test/api/platform/health", "GET"));
    const body = (await res.json()) as {
      overall: string;
      services: Array<{ name: string; status: string; details: string | null }>;
    };
    expect(body.overall).toBe("degraded");
    expect(body.services.map((s) => [s.name, s.status])).toEqual([
      ["postgres", "ok"],
      ["redis", "down"],
      ["workers", "down"],
      ["minio", "ok"],
    ]);
    expect(body.services[2]!.details).toContain("600 s");
  });
});

describe("G5-13 /api/platform/usage", () => {
  it("counts TG chat replies plus TG reminders, in-app on its own", async () => {
    const res = await (usage as unknown as (r: Request) => Promise<Response>)(
      new Request("https://crm.test/api/platform/usage?period=week"),
    );
    expect(res.status).toBe(200);
    expect(h.messageWheres).toEqual([
      expect.objectContaining({ direction: "OUT", origin: null, conversation: { channel: "TG" } }),
      expect.objectContaining({ direction: "OUT", origin: null, conversation: { channel: "INAPP" } }),
    ]);
    expect(h.notifWhere).toMatchObject({
      channel: { in: ["TG", "INAPP"] },
      status: { in: ["SENT", "DELIVERED", "READ"] },
    });
    const body = (await res.json()) as {
      rows: Array<{ tgMessages: number; inappMessages: number }>;
      totals: { tgMessages: number; inappMessages: number };
    };
    expect(body.rows[0]).toMatchObject({ tgMessages: 104, inappMessages: 16 });
    expect(body.totals).toMatchObject({ tgMessages: 104, inappMessages: 16 });
  });
});

describe("G5-15 /api/admin/encryption-health", () => {
  const url = "https://crm.test/api/admin/encryption-health";

  it("tallies each column in one scan", async () => {
    const res = await encryptionHealth(json(url, "GET"));
    const body = (await res.json()) as { counts: Record<string, unknown> };
    expect(h.rawQueries).toHaveLength(4);
    expect(body.counts["patient.passport"]).toEqual({
      total: 15,
      null: 3,
      plaintext: 2,
      byVersion: { v1: 10 },
    });
  });

  it("audits a look once per window", async () => {
    await encryptionHealth(json(url, "GET"));
    expect(h.auditRows).toHaveLength(1);
    h.recentAudit = { id: "a1" };
    await encryptionHealth(json(url, "GET"));
    expect(h.auditRows).toHaveLength(1);
  });
});
