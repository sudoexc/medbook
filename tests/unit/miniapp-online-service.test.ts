/**
 * Audit MA-08: the Mini App guessed the service of an online booking.
 *
 * The wizard never asks for a service; `pickDefaultService` took the first
 * linked service whose category held «консульт», else the cheapest,
 * archived ones included. An archived consultation still linked to the
 * doctor failed every booking (service_not_found); a doctor with «Первичная»
 * and «Повторная» got whichever row came first, with its price; a doctor
 * with no service could never be booked and nobody said why.
 *
 * Now only active services count, a doctor without one is not listed, and
 * the service is explicit: the admin's pick (Doctor.onlineServiceId) while
 * it is an active link, else the doctor's only active service, else none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { onlineServiceIdOf, resolveOnlineService } from "@/lib/doctors/online-service";

const state = vi.hoisted(() => ({
  doctorRows: [] as Array<Record<string, unknown>>,
  doctorArgs: null as Record<string, unknown> | null,
  linkedCount: 1,
  bookCalls: 0,
  crmDoctor: null as Record<string, unknown> | null,
  updates: [] as unknown[],
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p1",
    patient: { id: "p1", fullName: "Dilnoza", preferredLang: "RU" },
  };
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
      return handler({ request, body, ctx });
    };
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/lib/api-handler", () => {
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
      return handler({ request, body });
    };
  return { createApiHandler: wrap, createApiListHandler: wrap };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        state.doctorArgs = args;
        return state.doctorRows;
      }),
      findUnique: vi.fn(async () => state.crmDoctor),
      update: vi.fn(async (args: { data: { onlineServiceId: string | null } }) => {
        state.updates.push(args);
        if (state.crmDoctor) state.crmDoctor.onlineServiceId = args.data.onlineServiceId;
        return state.crmDoctor;
      }),
    },
    serviceOnDoctor: { count: vi.fn(async () => state.linkedCount) },
  },
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p1",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/miniapp/idempotency", () => ({
  withIdempotency: (_r: Request, _s: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/server/observability/metrics", () => ({
  getMetrics: () => ({ bookingDuration: { observe: () => undefined } }),
}));
vi.mock("@/server/appointments/book", () => ({
  bookAppointment: vi.fn(async () => {
    state.bookCalls += 1;
    return { ok: false, reason: "doctor_busy" };
  }),
}));

import { GET as listDoctors } from "@/app/api/miniapp/doctors/route";
import { POST as book } from "@/app/api/miniapp/appointments/route";
import { GET as getOnline, PUT as putOnline } from "@/app/api/crm/doctors/[id]/online-service/route";

function doctorRow(id: string, onlineServiceId: string | null, serviceIds: string[]) {
  return {
    id,
    slug: id,
    nameRu: id,
    nameUz: id,
    specializationRu: "Невролог",
    specializationUz: "Nevrolog",
    photoUrl: null,
    bioRu: null,
    bioUz: null,
    rating: null,
    reviewCount: 0,
    color: "#000",
    onlineServiceId,
    services: serviceIds.map((sid) => ({ service: { id: sid, category: null, priceBase: 100 } })),
  };
}

beforeEach(() => {
  state.doctorRows = [];
  state.doctorArgs = null;
  state.linkedCount = 1;
  state.bookCalls = 0;
  state.crmDoctor = null;
  state.updates.length = 0;
});

describe("resolveOnlineService", () => {
  const first = { serviceId: "s_first", isActive: true };
  const repeat = { serviceId: "s_repeat", isActive: true };
  const archived = { serviceId: "s_2025", isActive: false };

  it("books the admin's pick while it is an active link", () => {
    expect(resolveOnlineService("s_repeat", [first, repeat])).toEqual({ kind: "chosen", serviceId: "s_repeat" });
  });

  it("books the only active service, ignoring archived links", () => {
    expect(resolveOnlineService(null, [archived, first])).toEqual({ kind: "only", serviceId: "s_first" });
    // A pick that was archived since is not honoured.
    expect(resolveOnlineService("s_2025", [archived, first])).toEqual({ kind: "only", serviceId: "s_first" });
  });

  it("never guesses between several services", () => {
    const r = resolveOnlineService(null, [first, repeat]);
    expect(r).toEqual({ kind: "ambiguous" });
    expect(onlineServiceIdOf(r)).toBeNull();
    expect(resolveOnlineService("s_gone", [first, repeat])).toEqual({ kind: "ambiguous" });
  });

  it("a doctor with only archived services has nothing to book", () => {
    expect(resolveOnlineService(null, [archived])).toEqual({ kind: "none" });
  });
});

describe("GET /api/miniapp/doctors", () => {
  it("lists only doctors with an active service and only their active services", async () => {
    await listDoctors(new Request("http://x/api/miniapp/doctors?clinicSlug=neurofax"));
    const args = state.doctorArgs as {
      where: { services: { some: Record<string, unknown> } };
      select: { services: { where: unknown } };
    };
    expect(args.where.services.some).toEqual({ service: { isActive: true } });
    expect(args.select.services.where).toEqual({ service: { isActive: true } });
  });

  it("keeps the service filter on active services", async () => {
    await listDoctors(new Request("http://x/api/miniapp/doctors?clinicSlug=neurofax&serviceId=s1"));
    const args = state.doctorArgs as { where: { services: { some: Record<string, unknown> } } };
    expect(args.where.services.some).toEqual({ service: { isActive: true }, serviceId: "s1" });
  });

  it("answers the explicit online service per doctor, null when it cannot be decided", async () => {
    state.doctorRows = [
      doctorRow("picked", "s_repeat", ["s_first", "s_repeat"]),
      doctorRow("single", null, ["s_only"]),
      doctorRow("several", null, ["s_first", "s_repeat"]),
    ];
    const res = await listDoctors(new Request("http://x/api/miniapp/doctors?clinicSlug=neurofax"));
    const { doctors } = (await res.json()) as { doctors: Array<{ id: string; onlineServiceId: string | null }> };
    expect(Object.fromEntries(doctors.map((d) => [d.id, d.onlineServiceId]))).toEqual({
      picked: "s_repeat",
      single: "s_only",
      several: null,
    });
  });
});

describe("POST /api/miniapp/appointments", () => {
  it("refuses a service the doctor does not offer before booking", async () => {
    state.linkedCount = 0;
    const res = await book(
      new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax", {
        method: "POST",
        body: JSON.stringify({ doctorId: "d1", serviceIds: ["s_other"], startAt: "2026-10-05T05:00:00.000Z" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "service_not_found" });
    expect(state.bookCalls).toBe(0);
  });
});

describe("/api/crm/doctors/[id]/online-service", () => {
  const url = "http://x/api/crm/doctors/d1/online-service";
  function crmDoctor(onlineServiceId: string | null) {
    return {
      id: "d1",
      onlineServiceId,
      services: [
        { service: { id: "s_first", nameRu: "Первичная", nameUz: "Birlamchi", isActive: true } },
        { service: { id: "s_repeat", nameRu: "Повторная", nameUz: "Takroriy", isActive: true } },
        { service: { id: "s_2025", nameRu: "Консультация 2025", nameUz: "2025", isActive: false } },
      ],
    };
  }
  const put = (serviceId: string | null) =>
    putOnline(new Request(url, { method: "PUT", body: JSON.stringify({ serviceId }) }));

  it("GET says a doctor with several services is not bookable online yet", async () => {
    state.crmDoctor = crmDoctor(null);
    const body = (await (await getOnline(new Request(url))).json()) as { resolution: unknown };
    expect(body.resolution).toEqual({ kind: "ambiguous" });
  });

  it("PUT stores an active linked service and the Mini App then books it", async () => {
    state.crmDoctor = crmDoctor(null);
    const res = await put("s_repeat");
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({
      onlineServiceId: "s_repeat",
      resolution: { kind: "chosen", serviceId: "s_repeat" },
    });
  });

  it("PUT refuses an archived or foreign service", async () => {
    state.crmDoctor = crmDoctor(null);
    expect((await put("s_2025")).status).toBe(422);
    expect((await put("s_nope")).status).toBe(422);
    expect(state.updates).toHaveLength(0);
  });

  it("PUT null clears the pick", async () => {
    state.crmDoctor = crmDoctor("s_first");
    expect((await put(null)).status).toBe(200);
    expect(state.crmDoctor!.onlineServiceId).toBeNull();
  });
});
