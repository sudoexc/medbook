/**
 * The appointment read routes behind three low audit items.
 *
 *  - AP-13: GET /api/crm/appointments/[id] (the drawer, open to the call
 *    operator and the nurse) sent the whole Patient row: passport, address,
 *    notes, telegramId. It now selects the fields the drawer reads.
 *  - AP-23: the «Услуга» filter was dropped by the query schema, so the list
 *    never narrowed. It now matches the main service or any service line.
 *  - AP-21: the tiles counted the loaded page. The list's first page now
 *    carries the clock-dependent tile counts over the whole filter set.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findUniqueArgs: [] as Array<Record<string, unknown>>,
  findManyArgs: [] as Array<Record<string, unknown>>,
  countArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async (args: Record<string, unknown>) => {
        h.findUniqueArgs.push(args);
        return {
          id: "ap_1",
          patientId: "p_1",
          medicalCaseId: null,
          doctor: { userId: "u_doc" },
          patient: { id: "p_1", fullName: "Алиев Вали" },
          payments: [],
        };
      }),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.findManyArgs.push(args);
        return [];
      }),
      count: vi.fn(async (args: Record<string, unknown>) => {
        h.countArgs.push(args);
        return 3;
      }),
      groupBy: vi.fn(async () => [
        { status: "WAITING", _count: { _all: 2 } },
        { status: "BOOKED", _count: { _all: 5 } },
      ]),
    },
  },
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    (request: Request) =>
      handler({
        request,
        ctx: { kind: "TENANT", clinicId: "c1", userId: "u_rec", role: "CALL_OPERATOR" },
      }),
  createApiHandler: () => async () => new Response(null, { status: 405 }),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/server/appointments/book", () => ({ bookAppointment: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({ newCorrelationId: () => "corr" }));

beforeEach(() => {
  h.findUniqueArgs = [];
  h.findManyArgs = [];
  h.countArgs = [];
});

describe("AP-13: the drawer's GET sends only what the drawer reads", () => {
  it("selects the patient's display fields, never passport, address or notes", async () => {
    const { GET } = await import("@/app/api/crm/appointments/[id]/route");
    const res = await GET(new Request("https://x/api/crm/appointments/ap_1"));
    expect(res.status).toBe(200);
    const include = h.findUniqueArgs[0]!.include as Record<string, { select?: Record<string, true> }>;
    expect(Object.keys(include.patient!.select!).sort()).toEqual(
      ["birthDate", "fullName", "gender", "id", "phone", "photoUrl", "segment"],
    );
    for (const secret of ["passport", "address", "notes", "telegramId"]) {
      expect(include.patient!.select).not.toHaveProperty(secret);
    }
    expect(Object.keys(include.payments!.select!).sort()).toEqual(
      ["amount", "id", "method", "status"],
    );
  });
});

describe("AP-23 and AP-21: the list route", () => {
  async function list(qs: string) {
    const { GET } = await import("@/app/api/crm/appointments/route");
    const res = await GET(new Request(`https://x/api/crm/appointments?${qs}`));
    return (await res.json()) as { tally: Record<string, number> };
  }

  it("narrows to the chosen service, main or in a service line, beside the search", async () => {
    await list("serviceId=svc_eeg&q=Алиев");
    const where = h.findManyArgs[0]!.where as Record<string, unknown>;
    expect(where.AND).toEqual([
      { OR: [{ serviceId: "svc_eeg" }, { services: { some: { serviceId: "svc_eeg" } } }] },
    ]);
    // The search keeps its own OR.
    expect(JSON.stringify(where.OR)).toContain("Алиев");
  });

  it("leaves the list whole without a service", async () => {
    await list("");
    const where = h.findManyArgs[0]!.where as Record<string, unknown>;
    expect(where).not.toHaveProperty("AND");
  });

  it("the first page counts «скоро» and «просрочены» over every filter but the status", async () => {
    const body = await list("status=BOOKED&serviceId=svc_eeg");
    expect(body.tally.soon).toBe(3);
    expect(body.tally.overdue).toBe(3);
    // total + soon + overdue
    expect(h.countArgs).toHaveLength(3);
    const timed = h.countArgs.slice(1).map((a) => a.where as { AND: Array<Record<string, unknown>> });
    for (const w of timed) {
      // The status tile filter is not applied; the service filter is.
      expect(w.AND[0]).not.toHaveProperty("status");
      expect(w.AND[0]).toHaveProperty("AND");
    }
    expect(timed[0]!.AND[1]!.status).toEqual({ in: ["BOOKED", "CONFIRMED"] });
    expect(timed[1]!.AND[1]!.status).toEqual({ in: ["BOOKED", "CONFIRMED", "SKIPPED"] });
  });

  it("later pages skip the two counts", async () => {
    const body = await list("cursor=ap_50");
    expect(body.tally.soon).toBeUndefined();
    expect(h.countArgs).toHaveLength(1);
  });
});
