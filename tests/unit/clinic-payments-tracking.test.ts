/**
 * Audit PT-08, final review: «Учёт оплат в CRM» is an admin's switch.
 *
 * Patient debt used to switch on by itself with the clinic's first real PAID
 * payment. The clinic takes money at the till, so one card payment entered
 * in the visit drawer showed every later walk-in as «Долг». Now the clinic
 * settings form sends `tracksPayments` and the route keeps the moment it
 * was turned on in `Clinic.paymentsTrackedSince`:
 *   - on stamps now; saving the form again with it still on keeps the
 *     original moment (a re-save must not forgive earlier debt);
 *   - off clears it;
 *   - a save that does not touch it leaves the column alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clinic: {
    id: "c1",
    require2faForAll: false,
    sessionIdleTimeoutMinutes: 30,
    tgBotToken: null,
    tgWebhookSecret: null,
    logoUrl: null,
    letterheadUrl: null,
    paymentsTrackedSince: null as Date | null,
  } as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" };
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
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/storage-ref", () => ({ staffFileHref: (v: unknown) => v ?? null }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async () => ({ ...state.clinic })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        Object.assign(state.clinic, data);
        return { ...state.clinic };
      }),
    },
    subscription: { findUnique: vi.fn(async () => null) },
  },
}));

import { PATCH } from "@/app/api/crm/clinic/route";

function save(body: Record<string, unknown>) {
  return PATCH(
    new Request("https://x/api/crm/clinic", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.clinic.paymentsTrackedSince = null;
  state.updates = [];
});

describe("PATCH /api/crm/clinic — «Учёт оплат в CRM»", () => {
  it("turning it on stamps the moment; the switch itself is not a column", async () => {
    const before = Date.now();
    const res = await save({ tracksPayments: true });
    expect(res.status).toBe(200);
    const data = state.updates[0]!;
    expect(data).not.toHaveProperty("tracksPayments");
    expect(data.paymentsTrackedSince).toBeInstanceOf(Date);
    expect((data.paymentsTrackedSince as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("saving again with it still on keeps the original moment", async () => {
    const since = new Date("2026-10-05T09:00:00Z");
    state.clinic.paymentsTrackedSince = since;
    await save({ tracksPayments: true, nameRu: "Нейрофакс" });
    expect(state.updates[0]).not.toHaveProperty("paymentsTrackedSince");
    expect(state.clinic.paymentsTrackedSince).toBe(since);
  });

  it("turning it off clears it", async () => {
    state.clinic.paymentsTrackedSince = new Date("2026-10-05T09:00:00Z");
    await save({ tracksPayments: false });
    expect(state.updates[0]).toMatchObject({ paymentsTrackedSince: null });
  });

  it("a save that does not touch the switch leaves it alone", async () => {
    await save({ nameRu: "Нейрофакс" });
    expect(state.updates[0]).not.toHaveProperty("paymentsTrackedSince");
    expect(state.updates[0]).not.toHaveProperty("tracksPayments");
  });

  it("the moment itself cannot be sent (no backdating from the form)", async () => {
    await save({ paymentsTrackedSince: "2020-01-01T00:00:00Z" });
    expect(state.updates[0]).not.toHaveProperty("paymentsTrackedSince");
  });
});
