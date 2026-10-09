/**
 * Owner account P0, part B (owner request 09.10.2026,
 * docs/design/OWNER-ACCOUNT.md §0, §2, §7 P0).
 *
 *   - The raw route handlers that cannot sit on createApiHandler (the chat
 *     upload, letterhead, branding, billing, report runs and schedules) now
 *     refuse a VIEW_ONLY visit with the wrapper's 403 and its
 *     SUPER_ADMIN_VIEW_AS_BLOCKED row. The chat upload used to let it
 *     through.
 *   - Inside a clinic the owner passes the «clinic admin» gates
 *     (`isClinicAdmin`): the routes that answered 403 to SUPER_ADMIN take
 *     him in a WRITE visit, the CRM screens get the admin's role.
 *   - No bare `role === "ADMIN"` gate is left outside the staff record
 *     checks that are about another account's stored role.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clinicViewRole, isClinicAdmin } from "@/lib/permissions/clinic-admin";
import { canEditPrice } from "@/lib/appointments/price-edit";

type Row = Record<string, unknown>;
type SessionUser = {
  id: string;
  role: string;
  clinicId: string | null;
  email: string;
  impersonation?: { grantId: string; mode: "WRITE" | "VIEW_ONLY" } | null;
};

const OWNER_WRITE: SessionUser = {
  id: "sa1",
  role: "SUPER_ADMIN",
  clinicId: "c1",
  email: "owner@example.test",
  impersonation: { grantId: "g1", mode: "WRITE" },
};
const OWNER_VIEW: SessionUser = {
  ...OWNER_WRITE,
  impersonation: { grantId: "g1", mode: "VIEW_ONLY" },
};
const ADMIN: SessionUser = { id: "a1", role: "ADMIN", clinicId: "c1", email: "a@example.test" };
const DOCTOR: SessionUser = { id: "d1", role: "DOCTOR", clinicId: "c1", email: "d@example.test" };

const REPORT_CONFIG = {
  version: 1,
  dimensions: ["source"],
  measures: ["count_visits"],
};

const h = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  auditLogCreate: vi.fn<(args: { data: Record<string, unknown> }) => Promise<object>>(
    async () => ({}),
  ),
  conversationFindFirst: vi.fn(async () => ({ id: "conv1", clinicId: "c1" })),
  uploadObject: vi.fn(async () => ({ url: "minio://x" })),
  audit: vi.fn(async () => undefined),
  runReport: vi.fn(async () => ({
    rows: [{ source: "INSTAGRAM", countVisits: BigInt(2) }],
    columns: [],
    rowCount: 1,
    truncated: false,
    runMs: 1,
    generatedAt: new Date().toISOString(),
  })),
  createUpgradeInvoice: vi.fn(async () => ({
    invoiceId: "inv1",
    number: "INV-1",
    amountTiins: BigInt(100),
  })),
  markInvoicePaid: vi.fn(async () => undefined),
  savedReportUpdate: vi.fn(async () => ({})),
  scheduleCreate: vi.fn(async ({ data }: { data: Row }) => ({
    id: "sch1",
    ...data,
    createdAt: new Date(),
  })),
  scheduleUpdate: vi.fn(async ({ data }: { data: Row }) => ({
    id: "sch1",
    cadence: "DAILY",
    deliveryChannel: "TELEGRAM",
    deliveryTarget: "12345",
    format: "csv",
    enabled: true,
    ...data,
    nextRunAt: new Date(),
    updatedAt: new Date(),
  })),
  scheduleDelete: vi.fn(async () => ({})),
  clinicUpdate: vi.fn(async () => ({})),
  findOrCreate: vi.fn<(input: Record<string, unknown>) => Promise<object>>(async () => ({
    ok: true,
    created: true,
    conversation: { id: "conv9", channel: "TELEGRAM" },
  })),
  hidden: new Set<string>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => (h.user ? { user: h.user } : null)),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { create: h.auditLogCreate },
    conversation: { findFirst: h.conversationFindFirst },
    doctor: { findFirst: vi.fn(async () => null) },
    subscription: {
      findUnique: vi.fn(async () => ({ planId: "p_basic", pendingPlanId: null, plan: {} })),
    },
    plan: { findUnique: vi.fn(async () => ({ id: "p_pro", slug: "pro" })) },
    invoice: { findFirst: vi.fn(async () => ({ id: "inv1", status: "DRAFT" })) },
    savedReport: {
      findFirst: vi.fn(async () => ({ id: "r1", name: "Отчёт", config: REPORT_CONFIG })),
      update: h.savedReportUpdate,
    },
    scheduledReport: {
      findMany: vi.fn(async () => []),
      create: h.scheduleCreate,
      findFirst: vi.fn(async () => ({
        id: "sch1",
        cadence: "DAILY",
        deliveryChannel: "TELEGRAM",
        deliveryTarget: "12345",
        format: "csv",
        enabled: true,
      })),
      update: h.scheduleUpdate,
      delete: h.scheduleDelete,
    },
    clinic: {
      findUnique: vi.fn(async () => ({ letterheadUrl: "x", logoUrl: null })),
      update: h.clinicUpdate,
    },
    handoutTemplate: {
      findMany: vi.fn(async () => [
        {
          id: "ht1",
          code: "H1",
          clinicId: null,
          titleRu: "Памятка",
          titleUz: "Eslatma",
          summaryRu: "",
          bodyMd: "",
          bodyMdUz: "",
          matchPrefixes: [],
          topic: "general",
          sortOrder: 0,
        },
      ]),
    },
  },
}));
vi.mock("@/server/storage/minio", () => ({
  isStubMode: () => false,
  uploadObject: h.uploadObject,
}));
vi.mock("@/server/storage/safe-file", () => ({
  checkUpload: () => ({ ok: true, mime: "image/png" }),
}));
vi.mock("@/server/analytics/report-runner", () => ({
  ReportTimeoutError: class ReportTimeoutError extends Error {},
  runReport: h.runReport,
}));
vi.mock("@/server/analytics/pdf", () => ({
  formatReportPdf: vi.fn(async () => Buffer.from("")),
  pdfFilename: () => "r.pdf",
}));
vi.mock("@/server/billing/invoice", () => ({
  createUpgradeInvoice: h.createUpgradeInvoice,
  markInvoicePaid: h.markInvoicePaid,
}));
vi.mock("@/server/platform/feature-guard", () => ({
  ensureFeature: vi.fn(async () => null),
}));
vi.mock("@/server/conversations/find-or-create", () => ({
  findOrCreateConversation: h.findOrCreate,
}));
vi.mock("@/server/catalog/clinic-overlay", () => ({
  loadClinicOverlays: vi.fn(async () => ({ hidden: h.hidden, overrides: new Map() })),
  applyClinicOverlay: (row: Row) => ({ ...row, clinicOverridden: false }),
}));

const BASE = "https://app.example/api/crm";

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function blockedRows(): Row[] {
  return h.auditLogCreate.mock.calls
    .map((c) => c[0].data)
    .filter((d) => d.action === "SUPER_ADMIN_VIEW_AS_BLOCKED");
}

async function expectViewOnlyBlock(res: Response, method: string, pathname: string) {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "ViewAsReadOnly", grantId: "g1" });
  const rows = blockedRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    clinicId: "c1",
    actorId: "sa1",
    actorRole: "SUPER_ADMIN",
    entityType: "ImpersonationGrant",
    entityId: "g1",
    meta: { method, path: pathname, clinicId: "c1" },
  });
}

beforeEach(() => {
  h.user = null;
  h.hidden = new Set();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ----- the helper -------------------------------------------------------------

describe("isClinicAdmin / clinicViewRole", () => {
  it("the clinic's ADMIN and the owner inside a clinic, nobody else", () => {
    expect(isClinicAdmin("ADMIN")).toBe(true);
    expect(isClinicAdmin("SUPER_ADMIN")).toBe(true);
    for (const r of ["DOCTOR", "RECEPTIONIST", "NURSE", "CALL_OPERATOR", "", null, undefined]) {
      expect(isClinicAdmin(r)).toBe(false);
    }
  });

  it("the CRM screens see the owner as the clinic's admin, every other role as itself", () => {
    expect(clinicViewRole("SUPER_ADMIN")).toBe("ADMIN");
    for (const r of ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE", "CALL_OPERATOR"]) {
      expect(clinicViewRole(r)).toBe(r);
    }
  });

  it("an appointment price is the clinic admin's call, the owner's too", () => {
    expect(canEditPrice("SUPER_ADMIN")).toBe(true);
    expect(canEditPrice("ADMIN")).toBe(true);
    expect(canEditPrice("DOCTOR")).toBe(false);
  });
});

// ----- the VIEW_ONLY hole -------------------------------------------------------

describe("POST /api/crm/conversations/[id]/attachments", () => {
  const url = `${BASE}/conversations/conv1/attachments`;
  function upload(): Request {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" }));
    return new Request(url, { method: "POST", body: form });
  }

  it("a read only visit is refused before the thread is read or a byte stored, and journaled", async () => {
    h.user = OWNER_VIEW;
    const { POST } = await import("@/app/api/crm/conversations/[id]/attachments/route");
    const res = await POST(upload());
    await expectViewOnlyBlock(res, "POST", "/api/crm/conversations/conv1/attachments");
    expect(h.conversationFindFirst).not.toHaveBeenCalled();
    expect(h.uploadObject).not.toHaveBeenCalled();
  });

  it("a WRITE visit uploads as before", async () => {
    h.user = OWNER_WRITE;
    const { POST } = await import("@/app/api/crm/conversations/[id]/attachments/route");
    const res = await POST(upload());
    expect(res.status).toBe(200);
    expect(h.uploadObject).toHaveBeenCalledTimes(1);
    expect(blockedRows()).toHaveLength(0);
  });

  it("clinic staff upload as before", async () => {
    h.user = DOCTOR;
    const { POST } = await import("@/app/api/crm/conversations/[id]/attachments/route");
    expect((await POST(upload())).status).toBe(200);
  });
});

describe("the letterhead and branding uploads journal the refusal now", () => {
  it("POST /settings/letterhead: 403 with the audit row", async () => {
    h.user = OWNER_VIEW;
    const { POST } = await import("@/app/api/crm/settings/letterhead/route");
    const form = new FormData();
    form.append("letterhead", new File([new Uint8Array([1])], "l.png", { type: "image/png" }));
    const res = await POST(new Request(`${BASE}/settings/letterhead`, { method: "POST", body: form }));
    await expectViewOnlyBlock(res, "POST", "/api/crm/settings/letterhead");
    expect(h.clinicUpdate).not.toHaveBeenCalled();
  });

  it("DELETE /settings/letterhead: 403 with the audit row", async () => {
    h.user = OWNER_VIEW;
    const { DELETE } = await import("@/app/api/crm/settings/letterhead/route");
    const res = await DELETE(new Request(`${BASE}/settings/letterhead`, { method: "DELETE" }));
    await expectViewOnlyBlock(res, "DELETE", "/api/crm/settings/letterhead");
    expect(h.clinicUpdate).not.toHaveBeenCalled();
  });

  it("PATCH /settings/branding: 403 with the audit row", async () => {
    h.user = OWNER_VIEW;
    const { PATCH } = await import("@/app/api/crm/settings/branding/route");
    const res = await PATCH(jsonReq(`${BASE}/settings/branding`, "PATCH", { brandColor: "#123456" }));
    await expectViewOnlyBlock(res, "PATCH", "/api/crm/settings/branding");
    expect(h.clinicUpdate).not.toHaveBeenCalled();
  });
});

// ----- the clinic admin routes ------------------------------------------------

describe("POST /api/crm/billing/upgrade", () => {
  const req = () => jsonReq(`${BASE}/billing/upgrade`, "POST", { targetPlanSlug: "pro" });

  it("the owner in a WRITE visit mints the invoice, as the clinic's admin does", async () => {
    const { POST } = await import("@/app/api/crm/billing/upgrade/route");
    for (const user of [OWNER_WRITE, ADMIN]) {
      h.user = user;
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect((await res.json()).invoiceId).toBe("inv1");
    }
    expect(h.createUpgradeInvoice).toHaveBeenCalledTimes(2);
  });

  it("a read only visit is refused and journaled, nothing minted", async () => {
    h.user = OWNER_VIEW;
    const { POST } = await import("@/app/api/crm/billing/upgrade/route");
    await expectViewOnlyBlock(await POST(req()), "POST", "/api/crm/billing/upgrade");
    expect(h.createUpgradeInvoice).not.toHaveBeenCalled();
  });

  it("other clinic roles still get 403", async () => {
    h.user = DOCTOR;
    const { POST } = await import("@/app/api/crm/billing/upgrade/route");
    expect((await POST(req())).status).toBe(403);
  });
});

describe("POST /api/crm/billing/invoices/[id]/simulate-pay (dev stub)", () => {
  const req = () => new Request(`${BASE}/billing/invoices/inv1/simulate-pay`, { method: "POST" });

  it("the owner in a WRITE visit may use it; a read only visit may not", async () => {
    vi.stubEnv("NEXT_PUBLIC_BILLING_STUB", "1");
    const { POST } = await import("@/app/api/crm/billing/invoices/[id]/simulate-pay/route");
    h.user = OWNER_WRITE;
    expect((await POST(req())).status).toBe(200);
    expect(h.markInvoicePaid).toHaveBeenCalledTimes(1);
    h.user = OWNER_VIEW;
    await expectViewOnlyBlock(
      await POST(req()),
      "POST",
      "/api/crm/billing/invoices/inv1/simulate-pay",
    );
    expect(h.markInvoicePaid).toHaveBeenCalledTimes(1);
  });
});

describe("analytics report runs", () => {
  it("POST /reports/run: the owner runs it in a WRITE visit, a read only visit is refused", async () => {
    const { POST } = await import("@/app/api/crm/analytics/reports/run/route");
    const req = () => jsonReq(`${BASE}/analytics/reports/run`, "POST", { config: REPORT_CONFIG });
    h.user = OWNER_WRITE;
    const ok = await POST(req());
    expect(ok.status).toBe(200);
    expect((await ok.json()).rowCount).toBe(1);
    h.user = OWNER_VIEW;
    await expectViewOnlyBlock(await POST(req()), "POST", "/api/crm/analytics/reports/run");
    expect(h.runReport).toHaveBeenCalledTimes(1);
  });

  it("POST /reports/[id]/run: the same, and no lastRunAt bump in a read only visit", async () => {
    const { POST } = await import("@/app/api/crm/analytics/reports/[id]/run/route");
    const req = () => new Request(`${BASE}/analytics/reports/r1/run`, { method: "POST" });
    h.user = OWNER_WRITE;
    expect((await POST(req())).status).toBe(200);
    expect(h.savedReportUpdate).toHaveBeenCalledTimes(1);
    h.user = OWNER_VIEW;
    await expectViewOnlyBlock(await POST(req()), "POST", "/api/crm/analytics/reports/r1/run");
    expect(h.savedReportUpdate).toHaveBeenCalledTimes(1);
  });

  it("a doctor still gets 403", async () => {
    h.user = DOCTOR;
    const { POST } = await import("@/app/api/crm/analytics/reports/run/route");
    const res = await POST(jsonReq(`${BASE}/analytics/reports/run`, "POST", { config: REPORT_CONFIG }));
    expect(res.status).toBe(403);
  });
});

describe("analytics report schedules", () => {
  const listUrl = `${BASE}/analytics/reports/r1/schedules`;
  const oneUrl = `${listUrl}/sch1`;
  const body = { cadence: "DAILY", deliveryChannel: "TELEGRAM", deliveryTarget: "12345", format: "csv" };

  it("GET: the owner lists them, in a read only visit too", async () => {
    const { GET } = await import("@/app/api/crm/analytics/reports/[id]/schedules/route");
    for (const user of [OWNER_WRITE, OWNER_VIEW]) {
      h.user = user;
      expect((await GET(new Request(listUrl))).status).toBe(200);
    }
    expect(blockedRows()).toHaveLength(0);
  });

  it("POST: the owner creates one in a WRITE visit, a read only visit is refused", async () => {
    const { POST } = await import("@/app/api/crm/analytics/reports/[id]/schedules/route");
    h.user = OWNER_WRITE;
    expect((await POST(jsonReq(listUrl, "POST", body))).status).toBe(201);
    h.user = OWNER_VIEW;
    await expectViewOnlyBlock(
      await POST(jsonReq(listUrl, "POST", body)),
      "POST",
      "/api/crm/analytics/reports/r1/schedules",
    );
    expect(h.scheduleCreate).toHaveBeenCalledTimes(1);
  });

  it("PATCH: the owner edits one in a WRITE visit, a read only visit is refused", async () => {
    const { PATCH } = await import("@/app/api/crm/analytics/reports/[id]/schedules/[scheduleId]/route");
    h.user = OWNER_WRITE;
    expect((await PATCH(jsonReq(oneUrl, "PATCH", { format: "pdf" }))).status).toBe(200);
    h.user = OWNER_VIEW;
    await expectViewOnlyBlock(
      await PATCH(jsonReq(oneUrl, "PATCH", { format: "pdf" })),
      "PATCH",
      "/api/crm/analytics/reports/r1/schedules/sch1",
    );
    expect(h.scheduleUpdate).toHaveBeenCalledTimes(1);
  });

  it("DELETE: the owner removes one in a WRITE visit, a read only visit is refused", async () => {
    const { DELETE } = await import("@/app/api/crm/analytics/reports/[id]/schedules/[scheduleId]/route");
    h.user = OWNER_WRITE;
    expect((await DELETE(new Request(oneUrl, { method: "DELETE" }))).status).toBe(200);
    h.user = OWNER_VIEW;
    await expectViewOnlyBlock(
      await DELETE(new Request(oneUrl, { method: "DELETE" })),
      "DELETE",
      "/api/crm/analytics/reports/r1/schedules/sch1",
    );
    expect(h.scheduleDelete).toHaveBeenCalledTimes(1);
  });

  it("a doctor still gets 403", async () => {
    h.user = DOCTOR;
    const { GET } = await import("@/app/api/crm/analytics/reports/[id]/schedules/route");
    expect((await GET(new Request(listUrl))).status).toBe(403);
  });
});

describe("createApiHandler routes that asked for the ADMIN role", () => {
  it("find-or-create: the owner starts a thread as the clinic's admin, not as reception", async () => {
    h.user = OWNER_WRITE;
    const { POST } = await import("@/app/api/crm/conversations/find-or-create/route");
    const res = await POST(jsonReq(`${BASE}/conversations/find-or-create`, "POST", { patientId: "p1" }));
    expect(res.status).toBe(201);
    expect(h.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ initiatorRole: "ADMIN", initiatorUserId: "sa1" }),
    );
  });

  it("handouts: the owner sees the entries the clinic hid, as its admin does; a doctor does not", async () => {
    h.hidden = new Set(["H1"]);
    const { GET } = await import("@/app/api/crm/catalogs/handouts/route");
    const get = async () =>
      (await (await GET(new Request(`${BASE}/catalogs/handouts?includeHidden=1`))).json()) as {
        total: number;
      };
    h.user = OWNER_VIEW;
    expect((await get()).total).toBe(1);
    h.user = ADMIN;
    expect((await get()).total).toBe(1);
    h.user = DOCTOR;
    expect((await get()).total).toBe(0);
  });
});

// ----- the screens ---------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("the CRM screens", () => {
  it("the role provider gets the owner as the clinic's admin", () => {
    const layout = read("src/app/[locale]/crm/layout.tsx");
    expect(layout).toMatch(/<CrmRoleProvider role=\{clinicViewRole\(session\?\.user\?\.role \?\? "ADMIN"\)\}>/);
  });

  it("the gates design §0 names use isClinicAdmin", () => {
    for (const rel of [
      "src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx",
      "src/app/[locale]/crm/patients/[id]/_components/patient-info-panel.tsx",
      "src/app/[locale]/crm/patients/[id]/_components/tabs/issued-forms-section.tsx",
      "src/app/[locale]/crm/patients/[id]/_components/tabs/documents-tab.tsx",
      "src/app/[locale]/crm/telegram/page.tsx",
      "src/app/[locale]/crm/action-center/page.tsx",
      "src/app/api/crm/conversations/[id]/route.ts",
    ]) {
      expect(read(rel), rel).toMatch(/isClinicAdmin\(/);
    }
  });
});

describe("no bare ADMIN gate is left", () => {
  // Checks about another account's stored role (the last admin guard, the
  // role a form edits), and the sidebar whose role prop the layout already
  // folds SUPER_ADMIN into. Everything else that means «clinic admin» goes
  // through isClinicAdmin or names SUPER_ADMIN next to ADMIN.
  const STAFF_RECORD_CHECKS = new Set([
    "src/app/api/crm/users/[id]/route.ts",
    "src/server/platform/user-change.ts",
    "src/components/layout/crm-sidebar.tsx",
  ]);
  const BARE = /(===|!==)\s*["']ADMIN["']|["']ADMIN["']\s*(===|!==)/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("in src/app, src/components, src/server and src/lib", () => {
    const offenders: string[] = [];
    for (const top of ["src/app", "src/components", "src/server", "src/lib"]) {
      for (const file of walk(path.join(ROOT, top))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        if (STAFF_RECORD_CHECKS.has(rel)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (!BARE.test(line)) return;
          // The same condition names SUPER_ADMIN within a few lines.
          const around = lines.slice(Math.max(0, i - 4), i + 5).join("\n");
          if (around.includes("SUPER_ADMIN")) return;
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
