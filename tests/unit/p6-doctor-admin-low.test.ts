/**
 * Low-severity doctor admin fixes (audit DR-12, DR-13, DR-14, DR-16, DR-17,
 * DR-18, DR-21).
 *
 *   DR-12  POST/PATCH of a doctor linked any posted serviceId, another
 *          clinic's included (ServiceOnDoctor is not tenant-scoped).
 *   DR-13  `userId` was taken as is from the payload, and the permanent
 *          delete switched that login off with no clinic or role check.
 *   DR-14  the cases card's repeat rate counted future, cancelled and
 *          no-show visits.
 *   DR-16  a doctor could PATCH his own row back to active, or rename it.
 *   DR-17  the AI panel copy carried invented times and patient counts.
 *   DR-18  «99:99» passed the schedule time check.
 *   DR-21  ?q= and ?specialization= were merged into one OR.
 *
 * `@/lib/prisma` is an in-memory stub; the routes and helpers run for real.
 * The handler stub honours `roles` the way createApiHandler does.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Appt = {
  id: string;
  doctorId: string;
  date: Date;
  createdAt: Date;
  medicalCaseId: string | null;
  status: string;
};

const h = vi.hoisted(() => ({
  role: "ADMIN" as string,
  userId: "admin1",
  services: [] as Array<{ id: string; clinicId: string; nameRu: string; nameUz: string; isActive: boolean }>,
  links: [] as Array<{ serviceId: string; doctorId: string; doctorActive: boolean }>,
  doctors: {} as Record<string, Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  createdLinks: [] as Array<Record<string, unknown>>,
  linkDeletes: 0,
  updates: [] as Array<Record<string, unknown>>,
  serviceFindManyArgs: [] as Array<Record<string, unknown>>,
  doctorFindManyArgs: null as null | Record<string, unknown>,
  userUpdateMany: null as null | { where: Record<string, unknown>; data: unknown },
  userUpdateManyCount: 1,
  appts: [] as Appt[],
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, entry: Record<string, unknown>) => {
    h.audits.push(entry);
  }),
}));
vi.mock("@/lib/site-prices", () => ({ invalidateSitePrices: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/branches/resolve-branch", () => ({
  resolveEffectiveBranchId: vi.fn(async () => null),
}));
vi.mock("@/server/doctors/ticket-prefix", () => ({
  nextFreeTicketPrefix: vi.fn(async () => "B"),
  takenTicketPrefixes: vi.fn(async () => []),
  isTicketPrefixConflict: vi.fn(() => false),
}));
vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: h.userId, role: h.role });
  const allowed = (roles?: string[]) =>
    !roles || roles.length === 0 || h.role === "SUPER_ADMIN" || roles.includes(h.role);
  return {
    createApiHandler:
      (
        opts: { roles?: string[]; bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        if (!allowed(opts.roles)) return Response.json({ error: "Forbidden" }, { status: 403 });
        return handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx: ctx(),
        });
      },
    createApiListHandler:
      (
        opts: { roles?: string[] },
        handler: (a: { request: Request; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) => {
        if (!allowed(opts.roles)) return Response.json({ error: "Forbidden" }, { status: 403 });
        return handler({ request, ctx: ctx() });
      },
  };
});

vi.mock("@/lib/prisma", () => {
  const count0 = { count: vi.fn(async () => 0) };
  const prisma: Record<string, unknown> = {
    doctor: {
      findUnique: vi.fn(async (args: { where: { id?: string; cabinetId?: string } }) => {
        if (args.where.cabinetId) return null; // the cabinet is free
        return h.doctors[args.where.id ?? ""] ?? null;
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.doctorFindManyArgs = args;
        return [];
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "d_new", ...data };
        h.created.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        h.updates.push(data);
        return { ...h.doctors[where.id], ...data };
      }),
      delete: vi.fn(async () => ({})),
    },
    cabinet: {
      findUnique: vi.fn(async () => ({ id: "cab_1", isActive: true })),
    },
    service: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] }; clinicId?: string; isActive?: boolean } }) => {
        h.serviceFindManyArgs.push(args as never);
        const { where } = args;
        return h.services
          .filter((s) => where.id.in.includes(s.id))
          .filter((s) => where.clinicId === undefined || s.clinicId === where.clinicId)
          .filter((s) => where.isActive === undefined || s.isActive === where.isActive)
          .map(({ id, nameRu, nameUz }) => ({ id, nameRu, nameUz }));
      }),
    },
    serviceOnDoctor: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            doctorId?: string | { not: string };
            serviceId?: { in: string[] };
            doctor?: { isActive?: boolean };
          };
        }) => {
          let rows = h.links;
          const { doctorId, serviceId } = where;
          if (typeof doctorId === "string") rows = rows.filter((l) => l.doctorId === doctorId);
          if (doctorId && typeof doctorId === "object") rows = rows.filter((l) => l.doctorId !== doctorId.not);
          if (serviceId) rows = rows.filter((l) => serviceId.in.includes(l.serviceId));
          if (where.doctor?.isActive === true) rows = rows.filter((l) => l.doctorActive);
          return rows.map((l) => ({ serviceId: l.serviceId }));
        },
      ),
      deleteMany: vi.fn(async () => {
        h.linkDeletes += 1;
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        h.createdLinks.push(...data);
        return { count: data.length };
      }),
    },
    lead: { updateMany: vi.fn(async () => ({ count: 0 })) },
    user: {
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: unknown }) => {
        h.userUpdateMany = args;
        return { count: h.userUpdateManyCount };
      }),
    },
    visitNote: count0,
    visitNoteAmendment: count0,
    prescription: count0,
    patientReview: count0,
    medicalCase: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    appointment: {
      count: vi.fn(async () => 0),
      // Applies the filters the case-stats route uses, so a missing filter
      // shows up as a wrong rate.
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            doctorId?: string;
            medicalCaseId?: { in: string[] };
            date?: { gte?: Date; lte?: Date };
            status?: { notIn?: string[] };
          };
        }) =>
          h.appts.filter((a) => {
            if (where.doctorId && a.doctorId !== where.doctorId) return false;
            if (where.medicalCaseId && !where.medicalCaseId.in.includes(a.medicalCaseId ?? "")) return false;
            if (where.date?.gte && a.date < where.date.gte) return false;
            if (where.date?.lte && a.date > where.date.lte) return false;
            if (where.status?.notIn && where.status.notIn.includes(a.status)) return false;
            return true;
          }),
      ),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
  return { prisma };
});

const svc = (id: string, clinicId = "c1") => ({
  id,
  clinicId,
  nameRu: `Услуга ${id}`,
  nameUz: `Xizmat ${id}`,
  isActive: true,
});

const NEW_DOCTOR = {
  slug: "new-doc",
  nameRu: "Новый Врач",
  nameUz: "Yangi Vrach",
  specializationRu: "Невролог",
  specializationUz: "Nevrolog",
  cabinetId: "cab_1",
};

function json(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.role = "ADMIN";
  h.userId = "admin1";
  h.services = [svc("svc_a"), svc("svc_b", "c2")];
  h.links = [];
  h.created = [];
  h.createdLinks = [];
  h.linkDeletes = 0;
  h.updates = [];
  h.serviceFindManyArgs = [];
  h.doctorFindManyArgs = null;
  h.userUpdateMany = null;
  h.userUpdateManyCount = 1;
  h.appts = [];
  h.audits = [];
  h.doctors = {
    d1: {
      id: "d1",
      clinicId: "c1",
      userId: "u_d1",
      isActive: false,
      cabinetId: "cab_1",
      ticketPrefix: "A",
      slug: "d-one",
      listedOnSite: true,
    },
  };
});

// ─── DR-12 ──────────────────────────────────────────────────────────────────

describe("DR-12: a doctor is linked only to this clinic's services", () => {
  it("findForeignServiceIds names the ids outside the clinic, once each", async () => {
    const { findForeignServiceIds } = await import("@/server/doctors/service-links");
    expect(await findForeignServiceIds(["svc_a", "svc_b", "svc_b", "ghost"], "c1")).toEqual([
      "svc_b",
      "ghost",
    ]);
    expect(h.serviceFindManyArgs[0]).toMatchObject({ where: { clinicId: "c1" } });
    expect(await findForeignServiceIds([], "c1")).toEqual([]);
  });

  it("POST with another clinic's service answers 422 and creates nothing", async () => {
    const { POST } = await import("@/app/api/crm/doctors/route");
    const res = await POST(
      json("POST", "https://x/api/crm/doctors", {
        ...NEW_DOCTOR,
        services: [{ serviceId: "svc_a" }, { serviceId: "svc_b" }],
      }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "service_not_found", serviceIds: ["svc_b"] });
    expect(h.created).toHaveLength(0);
    expect(h.createdLinks).toHaveLength(0);
  });

  it("POST with own services links them", async () => {
    const { POST } = await import("@/app/api/crm/doctors/route");
    const res = await POST(
      json("POST", "https://x/api/crm/doctors", { ...NEW_DOCTOR, services: [{ serviceId: "svc_a" }] }),
    );
    expect(res.status).toBe(201);
    expect(h.createdLinks).toEqual([
      { doctorId: "d_new", serviceId: "svc_a", priceOverride: null, durationMinOverride: null },
    ]);
  });

  it("PATCH with another clinic's service answers 422 and leaves the catalog alone", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      json("PATCH", "https://x/api/crm/doctors/d1", { services: [{ serviceId: "svc_b" }] }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "service_not_found", serviceIds: ["svc_b"] });
    expect(h.linkDeletes).toBe(0);
    expect(h.createdLinks).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it("PATCH with own services replaces the catalog", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(
      json("PATCH", "https://x/api/crm/doctors/d1", { services: [{ serviceId: "svc_a" }] }),
    );
    expect(res.status).toBe(200);
    expect(h.linkDeletes).toBe(1);
    expect(h.createdLinks.map((l) => l.serviceId)).toEqual(["svc_a"]);
  });
});

// ─── DR-13 ──────────────────────────────────────────────────────────────────

describe("DR-13: the doctor's login is never set from the doctor payload", () => {
  it("the create and update schemas drop userId", async () => {
    const { CreateDoctorSchema, UpdateDoctorSchema } = await import("@/server/schemas/doctor");
    expect(CreateDoctorSchema.parse({ ...NEW_DOCTOR, userId: "u_other_admin" })).not.toHaveProperty("userId");
    expect(UpdateDoctorSchema.parse({ userId: "u_other_admin" })).not.toHaveProperty("userId");
  });

  it("POST does not write a posted userId", async () => {
    const { POST } = await import("@/app/api/crm/doctors/route");
    const res = await POST(json("POST", "https://x/api/crm/doctors", { ...NEW_DOCTOR, userId: "u_x" }));
    expect(res.status).toBe(201);
    expect(h.created[0]).not.toHaveProperty("userId");
  });

  it("PATCH does not write a posted userId", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { userId: "u_x", color: "#3B82F6" }));
    expect(h.updates).toEqual([{ color: "#3B82F6" }]);
  });

  it("the permanent delete switches off only a DOCTOR login of this clinic", async () => {
    const { DELETE } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await DELETE(new Request("https://x/api/crm/doctors/d1?purge=true", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(h.userUpdateMany).toEqual({
      where: { id: "u_d1", clinicId: "c1", role: "DOCTOR" },
      data: { active: false },
    });
    expect(h.audits.at(-1)?.meta).toMatchObject({ purged: true, userDeactivated: true });
  });

  it("a linked admin or foreign login is left as is, and the audit says so", async () => {
    const { DELETE } = await import("@/app/api/crm/doctors/[id]/route");
    h.userUpdateManyCount = 0; // the where matched nobody
    await DELETE(new Request("https://x/api/crm/doctors/d1?purge=true", { method: "DELETE" }));
    expect(h.audits.at(-1)?.meta).toMatchObject({ userDeactivated: false });
  });
});

// ─── DR-16 ──────────────────────────────────────────────────────────────────

describe("DR-16: PATCH /doctors/[id] is the admin's", () => {
  it("a doctor cannot switch himself back on", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    h.role = "DOCTOR";
    h.userId = "u_d1";
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { isActive: true }));
    expect(res.status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });

  it("nor rename his public slug", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    h.role = "DOCTOR";
    h.userId = "u_d1";
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { slug: "new-slug" }));
    expect(res.status).toBe(403);
    expect(h.updates).toHaveLength(0);
  });

  it("the admin still can", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { isActive: true }));
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ isActive: true }]);
  });
});

// ─── DR-14 ──────────────────────────────────────────────────────────────────

describe("DR-14: the repeat rate counts held visits only", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  const appt = (id: string, days: number, caseId: string | null, status: string): Appt => ({
    id,
    doctorId: "d1",
    date: ago(days),
    createdAt: ago(days + 1),
    medicalCaseId: caseId,
    status,
  });

  it("future, cancelled and no-show visits change nothing", async () => {
    const { GET } = await import("@/app/api/crm/doctors/[id]/case-stats/route");
    h.appts = [
      // case A: first visit and a real repeat
      appt("a1", 60, "A", "COMPLETED"),
      appt("a2", 30, "A", "COMPLETED"),
      // case B: a cancelled first booking does not turn the real first
      // visit into a repeat
      appt("b0", 20, "B", "CANCELLED"),
      appt("b1", 10, "B", "COMPLETED"),
      // a no-show and next month's booking are not visits held
      appt("a3", 5, "A", "NO_SHOW"),
      appt("a4", -20, "A", "BOOKED"),
    ];
    const res = await GET(new Request("https://x/api/crm/doctors/d1/case-stats"));
    expect(res.status).toBe(200);
    // held: a1 (first), a2 (repeat), b1 (first) → 1 of 3
    expect(((await res.json()) as { repeatRatePct: number }).repeatRatePct).toBe(33.3);
  });

  it("an empty window reads 0", async () => {
    const { GET } = await import("@/app/api/crm/doctors/[id]/case-stats/route");
    h.appts = [appt("f1", -3, "A", "BOOKED")];
    const res = await GET(new Request("https://x/api/crm/doctors/d1/case-stats"));
    expect(((await res.json()) as { repeatRatePct: number }).repeatRatePct).toBe(0);
  });
});

// ─── DR-18 ──────────────────────────────────────────────────────────────────

describe("DR-18: schedule times are wall-clock times", () => {
  it("refuses 99:99, 24:00 and a one-digit hour; takes 00:00 and 23:59", async () => {
    const { ScheduleEntrySchema, ReplaceScheduleSchema } = await import("@/server/schemas/doctor");
    const entry = (startTime: string, endTime: string) =>
      ScheduleEntrySchema.safeParse({ weekday: 1, startTime, endTime }).success;
    expect(entry("99:99", "10:00")).toBe(false);
    expect(entry("09:00", "24:00")).toBe(false);
    expect(entry("9:00", "10:00")).toBe(false);
    expect(entry("09:60", "10:00")).toBe(false);
    expect(entry("00:00", "23:59")).toBe(true);
    expect(
      ReplaceScheduleSchema.safeParse({
        entries: [{ weekday: 1, startTime: "99:99", endTime: "10:00" }],
      }).success,
    ).toBe(false);
  });
});

// ─── DR-21 ──────────────────────────────────────────────────────────────────

describe("DR-21: name search and specialization are joined by AND", () => {
  it("?q= within ?specialization= is two OR groups under AND", async () => {
    const { GET } = await import("@/app/api/crm/doctors/route");
    await GET(
      new Request(
        `https://x/api/crm/doctors?q=${encodeURIComponent("Иванов")}&specialization=${encodeURIComponent("Невролог")}`,
      ),
    );
    const where = h.doctorFindManyArgs?.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("OR");
    expect(where.AND).toEqual([
      {
        OR: [
          { specializationRu: { contains: "Невролог", mode: "insensitive" } },
          { specializationUz: { contains: "Невролог", mode: "insensitive" } },
        ],
      },
      {
        OR: [
          { nameRu: { contains: "Иванов", mode: "insensitive" } },
          { nameUz: { contains: "Иванов", mode: "insensitive" } },
        ],
      },
    ]);
  });

  it("no filter, no AND", async () => {
    const { GET } = await import("@/app/api/crm/doctors/route");
    await GET(new Request("https://x/api/crm/doctors?isActive=false"));
    const where = h.doctorFindManyArgs?.where as Record<string, unknown>;
    expect(where).toEqual({ isActive: false });
  });
});

// ─── DR-17 ──────────────────────────────────────────────────────────────────

describe("DR-17: the AI panel copy carries no invented numbers", () => {
  const messages = (loc: "ru" | "uz") =>
    JSON.parse(
      readFileSync(path.resolve(__dirname, `../../src/messages/${loc}.json`), "utf8"),
    ) as { crmDoctors: { ai: Record<string, string> } };

  it.each(["ru", "uz"] as const)("%s: no clock times, counts or the evening tip", (loc) => {
    const ai = messages(loc).crmDoctors.ai;
    for (const [key, value] of Object.entries(ai)) {
      expect(value, key).not.toMatch(/\d/);
    }
    expect(ai).not.toHaveProperty("eveningTitle");
    expect(ai).not.toHaveProperty("eveningDescription");
  });
});
