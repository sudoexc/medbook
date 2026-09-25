/**
 * Audit LD-01 — a booking request from the public site must reach reception.
 *
 * Before: POST /api/leads wrote a `Lead` row and nothing else looked at it
 * (the CRM «Заявки» link 404'd, the list route read the never-written
 * `OnlineRequest` table, the only notification was an SMTP email that was
 * never configured). Pinned here:
 *   - the site POST writes the lead AND a `lead.created` outbox envelope in
 *     the same transaction (the live toast + badge signal);
 *   - the CRM list reads `Lead`, NEW first, with per-status tallies;
 *   - a status change writes `lead.updated` for the other operators;
 *   - the realtime client accepts the new envelopes;
 *   - the prod seed no longer wipes or fakes leads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Envelope = { type: string; payload: Record<string, unknown>; tenantScope: Record<string, unknown>; surface: string };

const state = {
  leadCreates: [] as Array<Record<string, unknown>>,
  leadUpdates: [] as Array<Record<string, unknown>>,
  outbox: [] as Envelope[],
  findManyArgs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<Record<string, unknown>>,
  role: "RECEPTIONIST" as string,
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_desk", role: state.role, clinicId: "c1", email: "d@x.t" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_desk",
    role: state.role,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/public-clinic", () => ({
  resolvePublicClinic: vi.fn(async () => ({ id: "c1", slug: "neurofax" })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/email", () => ({
  sendNewLeadEmail: vi.fn(async (data: Record<string, unknown>) => {
    state.emails.push(data);
  }),
}));

const leadRow = {
  id: "lead_1",
  name: "Мама Азизы",
  phone: "+998901234567",
  service: null,
  date: null,
  status: "NEW",
  source: "WEBSITE",
  comment: null,
  createdAt: new Date("2026-09-25T10:00:00Z"),
  updatedAt: new Date("2026-09-25T10:00:00Z"),
  doctorId: "doc_1",
  doctor: { id: "doc_1", nameRu: "Врач", nameUz: "Shifokor" },
  patient: null,
  appointment: null,
};

vi.mock("@/lib/prisma", () => {
  const prisma = {
    doctor: {
      findFirst: vi.fn(async () => ({
        nameRu: "Врач",
        user: { email: "doc@x.t" },
      })),
    },
    lead: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.leadCreates.push(data);
        return { id: "lead_1", name: data.name, phone: data.phone, service: data.service };
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        state.findManyArgs.push(args);
        return [leadRow];
      }),
      groupBy: vi.fn(async () => [
        { status: "NEW", _count: { _all: 3 } },
        { status: "CONVERTED", _count: { _all: 1 } },
      ]),
      findFirst: vi.fn(async () => ({
        id: "lead_1",
        status: "NEW",
        comment: null,
        name: "Мама Азизы",
        doctorId: "doc_1",
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.leadUpdates.push(data);
        return { ...leadRow, ...data };
      }),
    },
    // Must never be read again: nothing writes it.
    onlineRequest: {
      findMany: vi.fn(async () => {
        throw new Error("OnlineRequest has no writer; the list must read Lead");
      }),
    },
    eventOutbox: {
      create: vi.fn(async ({ data }: { data: { envelope: Envelope } }) => {
        state.outbox.push(data.envelope);
        return { id: "ob" };
      }),
    },
    $transaction: vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
      const { prisma: p } = await import("@/lib/prisma");
      return fn(p);
    }),
  };
  return { prisma };
});

beforeEach(() => {
  state.leadCreates = [];
  state.leadUpdates = [];
  state.outbox = [];
  state.findManyArgs = [];
  state.emails = [];
  state.role = "RECEPTIONIST";
});

describe("POST /api/leads (public site form)", () => {
  it("writes the lead and a lead.created envelope for reception", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const res = await POST(
      new Request("https://neurofax.uz/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Мама Азизы",
          phone: "90 123 45 67",
          doctorId: "doc_1",
          date: "2026-09-30",
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(state.leadCreates).toHaveLength(1);
    expect(state.leadCreates[0]).toMatchObject({
      clinicId: "c1",
      phone: "+998901234567",
      source: "WEBSITE",
      doctorId: "doc_1",
    });

    const created = state.outbox.filter((e) => e.type === "lead.created");
    expect(created).toHaveLength(1);
    expect(created[0].tenantScope.clinicId).toBe("c1");
    expect(created[0].surface).toBe("WEBSITE");
    expect(created[0].payload).toMatchObject({
      leadId: "lead_1",
      status: "NEW",
      name: "Мама Азизы",
    });
    // The phone number never rides on the bus.
    expect(JSON.stringify(created[0].payload)).not.toContain("901234567");
  });

  it("points the doctor email at a real route, not /ru/dashboard", async () => {
    const { POST } = await import("@/app/api/leads/route");
    await POST(
      new Request("https://neurofax.uz/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Иван", phone: "901234567", doctorId: "doc_1" }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(state.emails).toHaveLength(1);
    expect(String(state.emails[0].cabinetUrl)).toMatch(/\/doctor$/);
    expect(String(state.emails[0].cabinetUrl)).not.toContain("dashboard");
  });
});

describe("GET /api/crm/online-requests («Заявки» list)", () => {
  it("reads Lead (NEW first) and returns per-status tallies", async () => {
    const { GET } = await import("@/app/api/crm/online-requests/route");
    const res = await GET(new Request("https://x/api/crm/online-requests?limit=50"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ id: string }>;
      tally: Record<string, number>;
    };
    expect(body.rows.map((r) => r.id)).toEqual(["lead_1"]);
    expect(body.tally).toEqual({ NEW: 3, CONTACTED: 0, CONVERTED: 1, CANCELLED: 0 });
    expect(state.findManyArgs[0].orderBy).toEqual([
      { status: "asc" },
      { createdAt: "desc" },
    ]);
  });

  it("is closed to roles that do not work requests", async () => {
    state.role = "NURSE";
    const { GET } = await import("@/app/api/crm/online-requests/route");
    const res = await GET(new Request("https://x/api/crm/online-requests"));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/crm/online-requests/[id]", () => {
  it("updates the lead and tells the other operators via lead.updated", async () => {
    const { PATCH } = await import("@/app/api/crm/online-requests/[id]/route");
    const res = await PATCH(
      new Request("https://x/api/crm/online-requests/lead_1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "CONTACTED", comment: "Перезвонить в 18:00" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.leadUpdates[0]).toEqual({
      status: "CONTACTED",
      comment: "Перезвонить в 18:00",
    });
    const updated = state.outbox.filter((e) => e.type === "lead.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].payload).toMatchObject({ leadId: "lead_1", status: "CONTACTED" });
  });

  it("does not let the client set the patient link by hand", async () => {
    const { PATCH } = await import("@/app/api/crm/online-requests/[id]/route");
    const res = await PATCH(
      new Request("https://x/api/crm/online-requests/lead_1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId: "p_other" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(state.leadUpdates).toHaveLength(0);
  });
});

describe("realtime: lead envelopes reach CRM subscribers", () => {
  it("parseLiveEvent accepts a v2 lead.created envelope", async () => {
    const { parseLiveEvent } = await import("@/hooks/use-live-events");
    const ev = parseLiveEvent({
      eventId: "e1",
      correlationId: "c",
      at: "2026-09-25T10:00:00.000Z",
      type: "lead.created",
      payload: { leadId: "lead_1", status: "NEW", name: "Иван", doctorId: null },
      actor: {
        role: "EXTERNAL",
        userId: null,
        patientId: null,
        onBehalfOfPatientId: null,
        label: "website",
      },
      surface: "WEBSITE",
      tenantScope: { clinicId: "c1" },
    });
    expect(ev?.type).toBe("lead.created");
  });
});

describe("prod seed keeps real site requests", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../scripts/seed-mega-neurofax.ts"),
    "utf8",
  );
  it("does not wipe the Lead table", () => {
    const wipe = src.slice(src.indexOf("const wipeOrder = ["), src.indexOf("];", src.indexOf("const wipeOrder = [")));
    expect(wipe).not.toMatch(/^\s*"Lead",/m);
  });
  it("does not create fake leads", () => {
    expect(src).not.toMatch(/prisma\.lead\.create/);
  });
});
