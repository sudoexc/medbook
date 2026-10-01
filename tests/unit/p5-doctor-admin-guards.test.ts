/**
 * Doctor admin guards (audit DR-06, DR-07, DR-09, DR-11).
 *
 *   DR-07  «an active service has at least one active doctor» held only for
 *          deactivating a doctor. Unticking a service in the doctor's
 *          services editor and switching a retired service back on went
 *          around it. Both now answer 409 `service_orphaned` naming the
 *          service.
 *   DR-09  GET /api/crm/doctors (and /[id]) returned the whole Doctor row to
 *          every staff role: salary percent, login id and TV token in the
 *          front desk's devtools, and the reasons for time off.
 *   DR-06  adding time off said nothing about the visits already booked in
 *          the window and emitted no event, so open Mini Apps kept offering
 *          the days.
 *   DR-11  moving a doctor to another cabinet left his booked visits (and so
 *          the reminders, queue and board) in the old room.
 *
 * `@/lib/prisma` is an in-memory stub; the routes and helpers run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Link = { serviceId: string; doctorId: string; doctorActive: boolean };
type Svc = { id: string; nameRu: string; nameUz: string; isActive: boolean };

const h = vi.hoisted(() => ({
  role: "ADMIN" as string,
  userId: "admin1",
  links: [] as Link[],
  services: [] as Svc[],
  doctors: {} as Record<string, Record<string, unknown>>,
  findManyArgs: null as null | Record<string, unknown>,
  findUniqueArgs: null as null | Record<string, unknown>,
  timeOffs: [] as Array<Record<string, unknown>>,
  appointments: [] as Array<{ id: string; doctorId: string; date: Date; endDate: Date; status: string }>,
  outbox: [] as Array<Record<string, unknown>>,
  apptUpdateMany: null as null | { where: unknown; data: unknown },
  apptUpdateManyError: null as unknown,
  published: [] as unknown[],
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/site-prices", () => ({ invalidateSitePrices: vi.fn() }));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn((clinicId: string, ev: unknown) => {
    h.published.push({ clinicId, ev });
  }),
}));
vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: h.userId, role: h.role });
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx: ctx(),
        }),
    createApiListHandler:
      (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx: ctx() }),
  };
});

vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    doctor: {
      findUnique: vi.fn(async (args: { where: { id?: string; cabinetId?: string } }) => {
        h.findUniqueArgs = args as never;
        if (args.where.cabinetId) return null; // the new cabinet is free
        return h.doctors[args.where.id ?? ""] ?? null;
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.findManyArgs = args;
        return [];
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...h.doctors[where.id],
        ...data,
      })),
    },
    cabinet: {
      findUnique: vi.fn(async () => ({ id: "cab_205", isActive: true })),
    },
    serviceOnDoctor: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        let rows = h.links;
        if (typeof where?.doctorId === "string") rows = rows.filter((l) => l.doctorId === where.doctorId);
        if (where?.doctorId?.not) rows = rows.filter((l) => l.doctorId !== where.doctorId.not);
        if (where?.serviceId?.in) rows = rows.filter((l) => where.serviceId.in.includes(l.serviceId));
        if (where?.doctor?.isActive === true) rows = rows.filter((l) => l.doctorActive);
        return rows.map((l) => ({ serviceId: l.serviceId }));
      }),
      findFirst: vi.fn(async ({ where }: { where: { serviceId: string } }) => {
        const hit = h.links.find((l) => l.serviceId === where.serviceId && l.doctorActive);
        return hit ? { doctorId: hit.doctorId } : null;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    service: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; isActive?: boolean } }) =>
        h.services
          .filter((s) => where.id.in.includes(s.id))
          .filter((s) => where.isActive === undefined || s.isActive === where.isActive)
          .map(({ id, nameRu, nameUz }) => ({ id, nameRu, nameUz })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        h.services.find((s) => s.id === where.id) ?? null,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    doctorTimeOff: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "to_1", ...data };
        h.timeOffs.push(row);
        return row;
      }),
      findMany: vi.fn(async () => h.timeOffs),
      findFirst: vi.fn(async () => null),
    },
    doctorSchedule: { count: vi.fn(async () => 5) },
    appointment: {
      count: vi.fn(async ({ where }: { where: any }) => matchOverlap(where).length),
      findFirst: vi.fn(async ({ where, orderBy }: { where: any; orderBy: { date: "asc" | "desc" } }) => {
        const rows = matchOverlap(where).sort((a, b) => a.date.getTime() - b.date.getTime());
        const row = orderBy.date === "asc" ? rows[0] : rows[rows.length - 1];
        return row ? { date: row.date } : null;
      }),
      updateMany: vi.fn(async (args: { where: unknown; data: unknown }) => {
        h.apptUpdateMany = args;
        if (h.apptUpdateManyError) throw h.apptUpdateManyError;
        return { count: 3 };
      }),
    },
    eventOutbox: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.outbox.push(data);
        return data;
      }),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma));

  function matchOverlap(where: any) {
    return h.appointments.filter(
      (a) =>
        a.doctorId === where.doctorId &&
        where.status.in.includes(a.status) &&
        a.date < where.date.lt &&
        a.endDate > where.endDate.gt,
    );
  }
  return { prisma };
});

beforeEach(() => {
  h.role = "ADMIN";
  h.userId = "admin1";
  h.links = [];
  h.services = [];
  h.findManyArgs = null;
  h.timeOffs = [];
  h.appointments = [];
  h.outbox = [];
  h.apptUpdateMany = null;
  h.apptUpdateManyError = null;
  h.published = [];
  h.doctors = {
    d1: {
      id: "d1",
      clinicId: "c1",
      userId: "u_d1",
      isActive: true,
      cabinetId: "cab_101",
      ticketPrefix: "A",
      salaryPercent: 40,
      tvToken: "tv-secret",
    },
  };
});

const svc = (id: string, isActive = true): Svc => ({
  id,
  nameRu: `Услуга ${id}`,
  nameUz: `Xizmat ${id}`,
  isActive,
});

function json(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── DR-07 ──────────────────────────────────────────────────────────────────

describe("DR-07: no service is left without an active doctor", () => {
  it("findServicesOrphanedByUnlinking names the service only this doctor performs", async () => {
    const { findServicesOrphanedByUnlinking } = await import("@/server/doctors/deactivation");
    h.services = [svc("echo"), svc("eeg")];
    h.links = [
      { serviceId: "echo", doctorId: "d1", doctorActive: true },
      { serviceId: "eeg", doctorId: "d1", doctorActive: true },
      { serviceId: "eeg", doctorId: "d2", doctorActive: true },
    ];
    // Unticking both: only ЭхоКГ has nobody else.
    expect(await findServicesOrphanedByUnlinking("d1", [])).toEqual([
      { id: "echo", nameRu: "Услуга echo", nameUz: "Xizmat echo" },
    ]);
    // Keeping ЭхоКГ ticked: nothing is orphaned.
    expect(await findServicesOrphanedByUnlinking("d1", ["echo"])).toEqual([]);
  });

  it("an inactive doctor covers nothing, so unlinking his services orphans nothing", async () => {
    const { findServicesOrphanedByUnlinking } = await import("@/server/doctors/deactivation");
    h.doctors.d1!.isActive = false;
    h.services = [svc("echo")];
    h.links = [{ serviceId: "echo", doctorId: "d1", doctorActive: false }];
    expect(await findServicesOrphanedByUnlinking("d1", [])).toEqual([]);
  });

  it("PUT /doctors/[id]/services answers 409 with the service names", async () => {
    const { PUT } = await import("@/app/api/crm/doctors/[id]/services/route");
    h.services = [svc("echo")];
    h.links = [{ serviceId: "echo", doctorId: "d1", doctorActive: true }];
    const res = await PUT(
      json("PUT", "https://x/api/crm/doctors/d1/services", { assignments: [] }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string; orphanedServices: Svc[] };
    expect(body.reason).toBe("service_orphaned");
    expect(body.orphanedServices.map((s) => s.nameRu)).toEqual(["Услуга echo"]);
  });

  it("PATCH /doctors/[id] with services is held to the same rule", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    h.services = [svc("echo")];
    h.links = [{ serviceId: "echo", doctorId: "d1", doctorActive: true }];
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { services: [] }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("service_orphaned");
  });

  it("switching a retired service on without an active doctor is refused", async () => {
    const { PATCH } = await import("@/app/api/crm/services/[id]/route");
    h.services = [svc("echo", false)];
    h.links = [{ serviceId: "echo", doctorId: "d1", doctorActive: false }];
    const res = await PATCH(
      json("PATCH", "https://x/api/crm/services/echo", { isActive: true }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("service_orphaned");
  });

  it("switching it on is fine while an active doctor performs it", async () => {
    const { PATCH } = await import("@/app/api/crm/services/[id]/route");
    h.services = [svc("echo", false)];
    h.links = [{ serviceId: "echo", doctorId: "d1", doctorActive: true }];
    const res = await PATCH(
      json("PATCH", "https://x/api/crm/services/echo", { isActive: true }),
    );
    expect(res.status).toBe(200);
  });
});

// ─── DR-09 ──────────────────────────────────────────────────────────────────

describe("DR-09: each role reads only the doctor columns it may see", () => {
  it("doctorSelectFor: reception gets no salary, login or TV token; admin the whole row", async () => {
    const { doctorSelectFor } = await import("@/server/doctors/doctor-view");
    const staff = doctorSelectFor("staff")!;
    expect(staff).not.toHaveProperty("salaryPercent");
    expect(staff).not.toHaveProperty("userId");
    expect(staff).not.toHaveProperty("tvToken");
    expect(staff).not.toHaveProperty("signatureUrl");
    expect(staff).toMatchObject({ id: true, nameRu: true, cabinet: true });
    expect(doctorSelectFor("admin")).toBeNull();
    // A doctor addresses internal referrals to a colleague's login.
    expect(doctorSelectFor("doctor")).toMatchObject({ userId: true });
    expect(doctorSelectFor("doctor")).not.toHaveProperty("salaryPercent");
  });

  it("doctorAudience maps the roles", async () => {
    const { doctorAudience } = await import("@/server/doctors/doctor-view");
    const t = (role: string) =>
      doctorAudience({ kind: "TENANT", clinicId: "c1", userId: "u", role } as never);
    expect(t("ADMIN")).toBe("admin");
    expect(t("DOCTOR")).toBe("doctor");
    for (const r of ["RECEPTIONIST", "NURSE", "CALL_OPERATOR"]) expect(t(r)).toBe("staff");
    expect(doctorAudience({ kind: "SUPER_ADMIN", userId: "s" })).toBe("admin");
  });

  it("GET /api/crm/doctors under RECEPTIONIST selects without the private columns", async () => {
    const { GET } = await import("@/app/api/crm/doctors/route");
    h.role = "RECEPTIONIST";
    const res = await GET(new Request("https://x/api/crm/doctors?isActive=true"));
    expect(res.status).toBe(200);
    const select = h.findManyArgs?.select as Record<string, unknown>;
    expect(select).toBeTruthy();
    expect(select).not.toHaveProperty("salaryPercent");
    expect(select).not.toHaveProperty("userId");
    expect(select).not.toHaveProperty("tvToken");
  });

  it("GET /api/crm/doctors under ADMIN reads the whole row", async () => {
    const { GET } = await import("@/app/api/crm/doctors/route");
    h.role = "ADMIN";
    await GET(new Request("https://x/api/crm/doctors"));
    expect(h.findManyArgs?.select).toBeUndefined();
    expect(h.findManyArgs?.include).toEqual({ cabinet: true });
  });

  it("isActive=false filters inactive doctors instead of active ones (CT-12 class)", async () => {
    const { GET } = await import("@/app/api/crm/doctors/route");
    await GET(new Request("https://x/api/crm/doctors?isActive=false"));
    expect((h.findManyArgs?.where as { isActive?: boolean }).isActive).toBe(false);
  });

  it("time-off reasons are hidden from reception", async () => {
    const { GET } = await import("@/app/api/crm/doctors/[id]/time-off/route");
    h.role = "RECEPTIONIST";
    h.timeOffs = [{ id: "to_1", doctorId: "d1", reason: "больничный" }];
    const res = await GET(new Request("https://x/api/crm/doctors/d1/time-off"));
    const body = (await res.json()) as { rows: Array<{ reason: string | null }> };
    expect(body.rows[0]!.reason).toBeNull();
  });

  it("…but shown to the admin and to the doctor whose leave it is", async () => {
    const { GET } = await import("@/app/api/crm/doctors/[id]/time-off/route");
    h.timeOffs = [{ id: "to_1", doctorId: "d1", reason: "больничный" }];
    h.role = "ADMIN";
    let body = (await (await GET(new Request("https://x/api/crm/doctors/d1/time-off"))).json()) as {
      rows: Array<{ reason: string | null }>;
    };
    expect(body.rows[0]!.reason).toBe("больничный");
    h.role = "DOCTOR";
    h.userId = "u_d1";
    body = (await (await GET(new Request("https://x/api/crm/doctors/d1/time-off"))).json()) as {
      rows: Array<{ reason: string | null }>;
    };
    expect(body.rows[0]!.reason).toBe("больничный");
  });
});

// ─── DR-06 ──────────────────────────────────────────────────────────────────

describe("DR-06: time off warns about booked visits and emits a schedule event", () => {
  const startAt = "2026-10-10T04:00:00.000Z";
  const endAt = "2026-10-14T13:00:00.000Z";

  it("answers with the visits already booked inside the window", async () => {
    const { POST } = await import("@/app/api/crm/doctors/[id]/time-off/route");
    h.appointments = [
      { id: "a1", doctorId: "d1", status: "BOOKED", date: new Date("2026-10-11T05:00:00Z"), endDate: new Date("2026-10-11T05:30:00Z") },
      { id: "a2", doctorId: "d1", status: "CONFIRMED", date: new Date("2026-10-13T06:00:00Z"), endDate: new Date("2026-10-13T06:30:00Z") },
      // cancelled, other doctor, outside: not in the way
      { id: "a3", doctorId: "d1", status: "CANCELLED", date: new Date("2026-10-12T05:00:00Z"), endDate: new Date("2026-10-12T05:30:00Z") },
      { id: "a4", doctorId: "d2", status: "BOOKED", date: new Date("2026-10-12T05:00:00Z"), endDate: new Date("2026-10-12T05:30:00Z") },
      { id: "a5", doctorId: "d1", status: "BOOKED", date: new Date("2026-10-20T05:00:00Z"), endDate: new Date("2026-10-20T05:30:00Z") },
    ];
    const res = await POST(
      json("POST", "https://x/api/crm/doctors/d1/time-off", { startAt, endAt, reason: "Отпуск" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      affectedAppointments: { count: number; firstAt: string; lastAt: string };
    };
    expect(body.affectedAppointments).toEqual({
      count: 2,
      firstAt: "2026-10-11T05:00:00.000Z",
      lastAt: "2026-10-13T06:00:00.000Z",
    });
  });

  it("emits doctor.scheduleChanged through the outbox with the window", async () => {
    const { POST } = await import("@/app/api/crm/doctors/[id]/time-off/route");
    await POST(json("POST", "https://x/api/crm/doctors/d1/time-off", { startAt, endAt }));
    expect(h.outbox).toHaveLength(1);
    const row = h.outbox[0] as { type: string; envelope: { payload: Record<string, unknown> } };
    expect(row.type).toBe("doctor.scheduleChanged");
    expect(row.envelope.payload).toMatchObject({
      doctorId: "d1",
      change: "timeOffCreated",
      startAt,
      endAt,
    });
    // The reason never rides on the event.
    expect(JSON.stringify(row.envelope)).not.toContain("Отпуск");
  });

  it("an open Mini App receives the schedule event although it names no patient", async () => {
    const { shouldDeliverToMiniApp } = await import("@/app/api/miniapp/events/route");
    const envelope = {
      eventId: "e1",
      correlationId: "c",
      at: new Date().toISOString(),
      type: "doctor.scheduleChanged",
      payload: { doctorId: "d1", entryCount: 5, previousEntryCount: 5 },
      actor: { role: "ADMIN", userId: "u", patientId: null, onBehalfOfPatientId: null, label: "x" },
      surface: "CRM",
      tenantScope: { clinicId: "c1", doctorId: "d1" },
    };
    const allowed = { clinicId: "c1", patientIds: new Set(["p1"]) };
    expect(shouldDeliverToMiniApp(envelope as never, allowed as never)).toBe(true);
    expect(
      shouldDeliverToMiniApp(
        { ...envelope, tenantScope: { clinicId: "other" } } as never,
        allowed as never,
      ),
    ).toBe(false);
  });

  it("deleting a window of another doctor finds nothing (404), scoped by doctor", async () => {
    const { DELETE } = await import("@/app/api/crm/doctors/[id]/time-off/route");
    const res = await DELETE(
      new Request("https://x/api/crm/doctors/d1/time-off?entryId=to_other", { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
  });
});

// ─── DR-11 ──────────────────────────────────────────────────────────────────

describe("DR-11: a cabinet change moves the doctor's remaining visits", () => {
  it("cabinetMoveWhere: from the start of today in Tashkent, unfinished visits with a cabinet", async () => {
    const { cabinetMoveWhere } = await import("@/server/doctors/cabinet-move");
    // 2026-10-01 20:30 UTC = 2026-10-02 01:30 in Tashkent.
    const where = cabinetMoveWhere("d1", "cab_205", new Date("2026-10-01T20:30:00Z")) as any;
    expect(where.doctorId).toBe("d1");
    expect(where.date.gte.toISOString()).toBe("2026-10-01T19:00:00.000Z");
    expect(where.status.in).toEqual(
      expect.arrayContaining(["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS", "SKIPPED"]),
    );
    expect(where.status.in).not.toContain("COMPLETED");
    expect(where.status.in).not.toContain("CANCELLED");
    expect(where.status.in).not.toContain("NO_SHOW");
    expect(where.AND).toEqual([
      { cabinetId: { not: null } },
      { cabinetId: { not: "cab_205" } },
    ]);
  });

  it("PATCH with a new cabinet moves the visits in the same transaction and reports how many", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { cabinetId: "cab_205" }));
    expect(res.status).toBe(200);
    expect(h.apptUpdateMany?.data).toEqual({ cabinetId: "cab_205" });
    expect((h.apptUpdateMany?.where as { doctorId: string }).doctorId).toBe("d1");
    const body = (await res.json()) as { movedAppointments: number };
    expect(body.movedAppointments).toBe(3);
    // Reception's queue and the boards are told to refetch.
    expect(h.published).toEqual([
      { clinicId: "c1", ev: { type: "queue.updated", payload: { doctorId: "d1" } } },
    ]);
  });

  it("a visit already in the new room at the same time refuses the move (409)", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    h.apptUpdateManyError = Object.assign(
      new Error('conflicting key value violates exclusion constraint "Appointment_cabinet_no_overlap"'),
      { code: "23P01" },
    );
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { cabinetId: "cab_205" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("cabinet_schedule_conflict");
  });

  it("other edits do not touch the visits", async () => {
    const { PATCH } = await import("@/app/api/crm/doctors/[id]/route");
    const res = await PATCH(json("PATCH", "https://x/api/crm/doctors/d1", { color: "#3B82F6" }));
    expect(res.status).toBe(200);
    expect(h.apptUpdateMany).toBeNull();
  });
});
