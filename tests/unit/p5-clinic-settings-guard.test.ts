/**
 * Audit ST-07: the clinic settings form no longer carries the clinic's
 * on/off flag (the platform owns it), and PATCH writes only what differs
 * from the stored row, so a tab loaded earlier does not switch a suspended
 * clinic back on or put back a colleague's older values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  clinic: {} as Record<string, unknown>,
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

import { UpdateClinicSettingsSchema } from "@/server/schemas/settings";
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
  state.clinic = {
    id: "c1",
    active: false, // suspended by the platform
    nameRu: "Нейрофакс",
    phone: "+998 71 200 00 00",
    require2faForAll: false,
    sessionIdleTimeoutMinutes: 30,
    tgBotToken: null,
    tgWebhookSecret: null,
    logoUrl: null,
    letterheadUrl: null,
    paymentsTrackedSince: null,
    currency: "UZS",
    secondaryCurrency: null,
  };
  state.updates = [];
});

describe("UpdateClinicSettingsSchema", () => {
  it("has no clinic on/off flag: it is stripped", () => {
    const parsed = UpdateClinicSettingsSchema.parse({ active: true, nameRu: "X" });
    expect(parsed).not.toHaveProperty("active");
  });
});

describe("PATCH /api/crm/clinic", () => {
  it("cannot switch a clinic the platform suspended back on", async () => {
    const res = await save({ active: true, phone: "+998 71 200 00 01" });
    expect(res.status).toBe(200);
    expect(state.updates[0]).not.toHaveProperty("active");
    expect(state.clinic.active).toBe(false);
  });

  it("writes only the fields that changed", async () => {
    await save({
      nameRu: "Нейрофакс",
      phone: "+998 71 200 00 09",
      currency: "UZS",
      secondaryCurrency: null,
    });
    expect(state.updates[0]).toEqual({ phone: "+998 71 200 00 09" });
  });

  it("a save of unchanged values writes nothing", async () => {
    await save({ nameRu: "Нейрофакс", currency: "UZS" });
    expect(state.updates[0]).toEqual({});
  });
});
