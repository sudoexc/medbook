import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit MA-01 / MA-05: POST /api/miniapp/family used to «claim» an existing
 * card matching the typed full name + phone and link it as the caller's
 * relative — then her conclusions opened through `onBehalfOf`. A relative
 * is now always a NEW card, and the typed phone is not stored where a later
 * walk-in lookup by phone could find it.
 */

const state = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  patientLookups: 0,
}));

vi.mock("@/server/miniapp/handler", () => ({
  // GET is not exercised here.
  createMiniAppListHandler: () => async () => new Response(null, { status: 405 }),
  createMiniAppHandler:
    (
      _opts: unknown,
      handler: (args: {
        request: Request;
        body: unknown;
        ctx: unknown;
      }) => Promise<Response>,
    ) =>
    async (request: Request) =>
      handler({
        request,
        body: await request.json(),
        ctx: {
          clinicId: "c1",
          patientId: "attacker",
          patient: { preferredLang: "RU" },
        },
      }),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    patient: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `new${state.created.length + 1}`, ...data };
        state.created.push(row);
        return row;
      }),
    },
    patientFamily: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const patient = state.created.find((p) => p.id === data.linkedPatientId);
        const link = {
          id: `link${state.links.length + 1}`,
          ...data,
          createdAt: new Date(),
          linkedPatient: patient ?? { id: data.linkedPatientId },
        };
        state.links.push(link);
        return link;
      }),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      patient: {
        findFirst: vi.fn(async () => {
          state.patientLookups += 1;
          return { id: "victim" };
        }),
      },
      patientFamily: { findMany: vi.fn(async () => []) },
    },
  };
});

vi.mock("@/server/services/patient-number", () => ({
  allocatePatientNumber: vi.fn(async () => "P-0100"),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));

beforeEach(() => {
  state.created = [];
  state.links = [];
  state.patientLookups = 0;
});

describe("POST /api/miniapp/family", () => {
  it("never links an existing card found by name + phone", async () => {
    const { POST } = await import("@/app/api/miniapp/family/route");
    const res = await POST(
      new Request("https://neurofax.uz/api/miniapp/family?clinicSlug=neurofax", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Юсупова Лола Анваровна",
          phone: "+998901234567",
          relationship: "other",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.createdNew).toBe(true);
    expect(body.member.patient.id).not.toBe("victim");
    expect(state.links[0]!.linkedPatientId).not.toBe("victim");
    // Nobody was even looked up by those details.
    expect(state.patientLookups).toBe(0);
  });

  it("does not store the typed phone where a walk-in lookup would match it", async () => {
    const { POST } = await import("@/app/api/miniapp/family/route");
    await POST(
      new Request("https://neurofax.uz/api/miniapp/family?clinicSlug=neurofax", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: "Ребёнок",
          phone: "+998901234567",
          relationship: "child",
        }),
      }),
    );
    const card = state.created[0]!;
    expect(card.phone).toBe("");
    expect(String(card.phoneNormalized).startsWith("family:")).toBe(true);
  });
});
