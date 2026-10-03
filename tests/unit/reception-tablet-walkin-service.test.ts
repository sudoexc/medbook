import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reception tablet's optional «Услуга» on a walk-in: the CRM walk-in
 * route forwards `serviceId` to `registerWalkin` (which prices and sizes the
 * visit the way the kiosk's choice does) and answers 409
 * `service_not_offered` for a service the doctor does not offer. Without one
 * nothing changes: the visit is a consultation, as before.
 */

const state = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  result: null as unknown,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" };
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
          ctx,
        }),
  };
});

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_r: unknown, entry: Record<string, unknown>) => {
    state.audits.push(entry);
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/billing/plan-limits", () => ({ ensureQuotaForApi: vi.fn(async () => null) }));
vi.mock("@/server/appointments/walkin", () => ({
  registerWalkin: vi.fn(async (input: Record<string, unknown>) => {
    state.calls.push(input);
    return state.result;
  }),
}));

const ISSUED = {
  ok: true,
  appointmentId: "a1",
  duplicate: false,
  ticketCode: "K7Q2M",
  ticketNumber: "A-012",
  queueOrder: 12,
  patient: { id: "p1", fullName: "Юсупова Лола" },
  doctor: { id: "doc_1", nameRu: "Эргашев Б.", nameUz: "Ergashev B.", color: null },
  cabinet: "101",
};

function post(body: unknown) {
  return new Request("https://x/api/crm/appointments/walkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.calls = [];
  state.result = ISSUED;
  state.audits = [];
});

describe("POST /api/crm/appointments/walkin with a service", () => {
  it("forwards the tablet's service to registerWalkin and records it", async () => {
    const { POST } = await import("@/app/api/crm/appointments/walkin/route");
    const res = await POST(post({ doctorId: "doc_1", patientId: "p1", serviceId: "svc_eeg" }));
    expect(res.status).toBe(201);
    expect(state.calls[0]).toMatchObject({
      clinicId: "c1",
      doctorId: "doc_1",
      patient: { id: "p1" },
      serviceId: "svc_eeg",
    });
    expect(state.audits[0]!.meta).toMatchObject({ serviceId: "svc_eeg" });
    expect(await res.json()).toMatchObject({ ticketNumber: "A-012", ticketCode: "K7Q2M" });
  });

  it("without a service the visit stays a consultation", async () => {
    const { POST } = await import("@/app/api/crm/appointments/walkin/route");
    await POST(post({ doctorId: "doc_1", patientId: "p1" }));
    expect(state.calls[0]!.serviceId).toBeNull();
    expect(state.audits[0]!.meta).not.toHaveProperty("serviceId");
  });

  it("a service the doctor does not offer is a 409 the tablet words", async () => {
    state.result = { ok: false, reason: "service_not_offered" };
    const { POST } = await import("@/app/api/crm/appointments/walkin/route");
    const res = await POST(post({ doctorId: "doc_1", patientId: "p1", serviceId: "svc_other" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "service_not_offered" });
  });

  it("an empty service id is refused by validation, not passed on", async () => {
    const { POST } = await import("@/app/api/crm/appointments/walkin/route");
    await expect(POST(post({ doctorId: "doc_1", patientId: "p1", serviceId: "" }))).rejects.toThrow();
    expect(state.calls).toHaveLength(0);
  });
});
