/**
 * Audit ST-05: the integrations page saves only what something reads.
 *
 *   - Payme / Click / Uzum keys had no consumer: refused (the card says
 *     «Недоступно» and has no setup button);
 *   - a Telegram row changed nothing (the bot runs on the clinic's token):
 *     the wizard is the only way;
 *   - telephony saves the one thing the SIP webhook checks, its
 *     `webhookSecret`, which the old form never wrote; the card turns green
 *     only once a call arrives.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://neurofax.uz";
});

const h = vi.hoisted(() => ({
  existing: null as null | Record<string, unknown>,
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
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
vi.mock("@/lib/prisma", () => {
  const row = (data: Record<string, unknown>) => ({
    id: "pc1",
    clinicId: "c1",
    kind: "OTHER",
    label: "sip",
    secretCipher: "",
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  });
  return {
    prisma: {
      clinic: { findUnique: vi.fn(async () => ({ slug: "neurofax" })) },
      providerConnection: {
        findMany: vi.fn(async () => (h.existing ? [h.existing] : [])),
        findFirst: vi.fn(async () => h.existing),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          h.created.push(data);
          return row(data);
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          h.updated.push(data);
          return row({ ...h.existing, ...data });
        }),
      },
    },
  };
});

import { GET, POST } from "@/app/api/crm/integrations/route";
import { telephonyStatusFrom } from "@/server/telephony/status";

function save(body: Record<string, unknown>) {
  return POST(
    new Request("https://x/api/crm/integrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.existing = null;
  h.created = [];
  h.updated = [];
});

describe("POST /api/crm/integrations", () => {
  it("payment keys are refused: nothing would read them", async () => {
    for (const kind of ["PAYME", "CLICK", "UZUM", "OPENAI"]) {
      const res = await save({ kind, secret: "k", currentPassword: "p" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ reason: "provider_not_supported" });
    }
    expect(h.created).toHaveLength(0);
  });

  it("the bot is managed by the connect wizard only", async () => {
    const res = await save({ kind: "TELEGRAM", secret: "123:abc", currentPassword: "p" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "managed_by_wizard" });
  });

  it("telephony gets the webhook secret the SIP endpoint checks", async () => {
    const res = await save({ kind: "OTHER", label: "sip", active: true });
    expect(res.status).toBe(201);
    const cfg = h.created[0]!.config as { webhookSecret: string };
    expect(cfg.webhookSecret).toMatch(/^[0-9a-f]{48}$/);
    const body = await res.json();
    expect(body.sipWebhookUrl).toBe(
      "https://neurofax.uz/api/calls/sip/event?clinicSlug=neurofax",
    );
    // Ready for events, but not «Подключено» until a call arrives.
    const status = telephonyStatusFrom({
      connection: { active: true, config: cfg },
      lastProviderCallAt: null,
    });
    expect(status).toMatchObject({ webhookReady: true, connected: false });
  });

  it("saving again keeps the secret; rotating issues a new one", async () => {
    h.existing = {
      id: "pc1",
      kind: "OTHER",
      label: "sip",
      config: { webhookSecret: "keep-me", server: "legacy" },
    };
    await save({ kind: "OTHER", label: "sip" });
    expect(h.updated[0]!.config).toEqual({ webhookSecret: "keep-me", server: "legacy" });

    await save({ kind: "OTHER", label: "sip", rotateWebhookSecret: true });
    const rotated = h.updated[1]!.config as { webhookSecret: string };
    expect(rotated.webhookSecret).not.toBe("keep-me");
  });

  it("a SIP password is refused: no PBX adapter would use it", async () => {
    const res = await save({ kind: "OTHER", label: "sip", secret: "pbx-pass" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "secret_not_used" });
  });
});

describe("GET /api/crm/integrations", () => {
  it("tells the page where the PBX must post", async () => {
    const res = await GET(new Request("https://x/api/crm/integrations"));
    expect(await res.json()).toMatchObject({
      rows: [],
      sipWebhookUrl: "https://neurofax.uz/api/calls/sip/event?clinicSlug=neurofax",
    });
  });
});
