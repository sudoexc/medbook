/**
 * The call-center API (audit CM-07, CM-09, CM-13):
 *   - «Завершить» / «Пропуск» close the call with status, direction and
 *     duration, refuse a call already over, and tell every operator;
 *   - «Перезвонил» marks a missed call handled, once;
 *   - a call's patient / operator / visit must be this clinic's, and an
 *     `endedAt` slipped into the PATCH is not written;
 *   - the list serves the live queue (`open=true`) and the missed calls by
 *     call-back state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = {
  id: string;
  clinicId: string;
  direction: "IN" | "OUT" | "MISSED";
  status: "RINGING" | "ANSWERED" | "ENDED" | "MISSED" | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  tags: string[];
  patientId: string | null;
  operatorId: string | null;
  appointmentId: string | null;
  sipCallId: string | null;
  fromNumber: string;
  toNumber: string;
  summary: string | null;
};

const h = vi.hoisted(() => ({
  role: "CALL_OPERATOR" as string,
  calls: new Map<string, Record<string, unknown>>(),
  patients: [] as Array<{ id: string; clinicId: string }>,
  users: [] as Array<{ id: string; clinicId: string }>,
  appointments: [] as Array<{ id: string; clinicId: string; patientId: string }>,
  events: [] as Array<{ clinicId: string; type: string; payload: unknown }>,
  audits: [] as string[],
  lastFindManyWhere: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_op", role: h.role, clinicId: "c1", email: "op@example.test" },
  })),
}));
vi.mock("@/lib/pin", () => ({ hasValidPin: () => false }));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "TENANT", clinicId: "c1", userId: "u_op", role: h.role }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/server/platform/feature-guard", () => ({
  ensureFeature: async () => null,
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, a: { action: string }) => {
    h.audits.push(a.action);
  }),
}));
vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: (clinicId: string, e: { type: string; payload: unknown }) => {
    h.events.push({ clinicId, type: e.type, payload: e.payload });
  },
}));
vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: async () => undefined,
}));
vi.mock("@/lib/prisma", () => {
  const byClinic = <T extends { id: string; clinicId: string }>(rows: T[], where: { id: string; clinicId: string }) =>
    rows.find((r) => r.id === where.id && r.clinicId === where.clinicId) ?? null;
  return {
    prisma: {
      call: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const row = h.calls.get(where.id);
          return row ? { ...row, patient: null, operator: null } : null;
        }),
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          h.lastFindManyWhere = where;
          return [];
        }),
        updateMany: vi.fn(
          async ({ where, data }: { where: { id: string; endedAt?: null }; data: Record<string, unknown> }) => {
            const row = h.calls.get(where.id);
            if (!row || (where.endedAt === null && row.endedAt !== null)) return { count: 0 };
            h.calls.set(where.id, { ...row, ...data });
            return { count: 1 };
          },
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const next = { ...h.calls.get(where.id), ...data };
          h.calls.set(where.id, next);
          return { ...next, patient: null, operator: null };
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: "new_call", createdAt: new Date(), ...data };
          h.calls.set("new_call", row);
          return row;
        }),
      },
      patient: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
          byClinic(h.patients, where),
        ),
      },
      user: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
          byClinic(h.users, where),
        ),
      },
      appointment: {
        findFirst: vi.fn(async ({ where }: { where: { id: string; clinicId: string } }) =>
          byClinic(h.appointments, where),
        ),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    },
  };
});

function call(id: string, over: Partial<Call> = {}): Call {
  return {
    id,
    clinicId: "c1",
    direction: "IN",
    status: "RINGING",
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    tags: [],
    patientId: null,
    operatorId: null,
    appointmentId: null,
    sipCallId: `sip-${id}`,
    fromNumber: "+998901234567",
    toNumber: "+998712001020",
    summary: null,
    ...over,
  };
}

function req(path: string, method: string, body?: unknown): Request {
  return new Request(`https://x${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  h.role = "CALL_OPERATOR";
  h.calls = new Map();
  h.patients = [
    { id: "p_own", clinicId: "c1" },
    { id: "p_foreign", clinicId: "c2" },
  ];
  h.users = [
    { id: "u_op", clinicId: "c1" },
    { id: "u_foreign", clinicId: "c2" },
  ];
  h.appointments = [
    { id: "ap_own", clinicId: "c1", patientId: "p_own" },
    { id: "ap_other_patient", clinicId: "c1", patientId: "p_x" },
  ];
  h.events = [];
  h.audits = [];
  h.lastFindManyWhere = null;
});

describe("CM-07 — POST /api/crm/calls/[id]/end", () => {
  async function end(id: string, outcome: "ENDED" | "MISSED") {
    const { POST } = await import("@/app/api/crm/calls/[id]/end/route");
    return POST(req(`/api/crm/calls/${id}/end`, "POST", { outcome }));
  }

  it("«Пропуск» makes it a counted missed call and tells every operator", async () => {
    h.calls.set("c_1", call("c_1"));
    const res = await end("c_1", "MISSED");
    expect(res.status).toBe(200);
    expect(h.calls.get("c_1")).toMatchObject({
      status: "MISSED",
      direction: "MISSED",
      durationSec: null,
      operatorId: "u_op",
    });
    expect(h.calls.get("c_1")!.endedAt).toBeInstanceOf(Date);
    expect(h.events.map((e) => e.type)).toEqual(["call.missed"]);
    expect(h.audits).toContain("call.mark_missed");
  });

  it("«Завершить» makes it ENDED with the talk time from the PBX answer", async () => {
    const answeredAt = new Date(Date.now() - 90_000);
    h.calls.set("c_2", call("c_2", { status: "ANSWERED", answeredAt }));
    const res = await end("c_2", "ENDED");
    expect(res.status).toBe(200);
    const row = h.calls.get("c_2")!;
    expect(row.status).toBe("ENDED");
    expect(row.direction).toBe("IN");
    expect(row.durationSec).toBeGreaterThanOrEqual(89);
    expect(row.durationSec).toBeLessThanOrEqual(91);
    expect(h.events.map((e) => e.type)).toEqual(["call.ended"]);
  });

  it("a call already over answers 409 and is left as it was", async () => {
    const endedAt = new Date("2026-09-30T10:00:00Z");
    h.calls.set("c_3", call("c_3", { status: "ENDED", endedAt, durationSec: 30 }));
    const res = await end("c_3", "MISSED");
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("call_already_ended");
    expect(h.calls.get("c_3")).toMatchObject({ status: "ENDED", durationSec: 30 });
    expect(h.events).toEqual([]);
  });

  it("is closed to roles outside the call center", async () => {
    h.role = "NURSE";
    h.calls.set("c_4", call("c_4"));
    expect((await end("c_4", "MISSED")).status).toBe(403);
    expect(h.calls.get("c_4")!.endedAt).toBeNull();
  });
});

describe("CM-13 — POST /api/crm/calls/[id]/called-back", () => {
  async function calledBack(id: string) {
    const { POST } = await import("@/app/api/crm/calls/[id]/called-back/route");
    return POST(req(`/api/crm/calls/${id}/called-back`, "POST"));
  }

  it("tags the missed call once, so it leaves the badge", async () => {
    h.calls.set("m_1", call("m_1", { direction: "MISSED", status: "MISSED", endedAt: new Date() }));
    expect((await calledBack("m_1")).status).toBe(200);
    expect(h.calls.get("m_1")!.tags).toEqual(["called_back"]);
    expect((await calledBack("m_1")).status).toBe(200);
    expect(h.calls.get("m_1")!.tags).toEqual(["called_back"]);
    expect(h.audits).toEqual(["call.called_back"]);
  });

  it("only a missed call can be marked", async () => {
    h.calls.set("a_1", call("a_1", { status: "ENDED", endedAt: new Date() }));
    expect((await calledBack("a_1")).status).toBe(409);
  });
});

describe("CM-09 — a call points only at this clinic's rows", () => {
  async function patch(id: string, body: unknown) {
    const { PATCH } = await import("@/app/api/crm/calls/[id]/route");
    return PATCH(req(`/api/crm/calls/${id}`, "PATCH", body));
  }

  it("another clinic's patient is refused (400) and nothing is written", async () => {
    h.calls.set("c_5", call("c_5"));
    const res = await patch("c_5", { patientId: "p_foreign" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("patient_not_found");
    expect(h.calls.get("c_5")!.patientId).toBeNull();
  });

  it("another clinic's user cannot become the operator", async () => {
    h.calls.set("c_6", call("c_6"));
    expect((await patch("c_6", { operatorId: "u_foreign" })).status).toBe(400);
  });

  it("a visit of another patient cannot be linked to the call's patient", async () => {
    h.calls.set("c_7", call("c_7", { patientId: "p_own" }));
    const res = await patch("c_7", { appointmentId: "ap_other_patient" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("appointment_patient_mismatch");
    expect((await patch("c_7", { appointmentId: "ap_own" })).status).toBe(200);
  });

  it("own rows link, and an endedAt in the body is not written (ending is POST .../end)", async () => {
    h.calls.set("c_8", call("c_8"));
    const res = await patch("c_8", {
      patientId: "p_own",
      summary: "перенести",
      endedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(200);
    expect(h.calls.get("c_8")).toMatchObject({ patientId: "p_own", summary: "перенести", endedAt: null });
  });

  it("POST refuses a foreign patient too", async () => {
    const { POST } = await import("@/app/api/crm/calls/route");
    const res = await POST(
      req("/api/crm/calls", "POST", {
        direction: "OUT",
        fromNumber: "+998712001020",
        toNumber: "+998901234567",
        patientId: "p_foreign",
      }),
    );
    expect(res.status).toBe(400);
    expect(h.calls.size).toBe(0);
  });
});

describe("CM-13 — GET /api/crm/calls filters", () => {
  async function list(qs: string) {
    const { GET } = await import("@/app/api/crm/calls/route");
    return GET(req(`/api/crm/calls?${qs}`, "GET"));
  }

  it("open=true serves the live queue from the server", async () => {
    expect((await list("direction=IN&open=true")).status).toBe(200);
    expect(h.lastFindManyWhere).toMatchObject({ direction: "IN", endedAt: null });
  });

  it("callback=pending hides the calls already called back", async () => {
    await list("direction=MISSED&callback=pending");
    expect(h.lastFindManyWhere).toMatchObject({
      direction: "MISSED",
      NOT: { tags: { has: "called_back" } },
    });
  });
});
