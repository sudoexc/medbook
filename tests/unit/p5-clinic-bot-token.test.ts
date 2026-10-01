/**
 * Audit ST-02: the clinic settings' «Секреты и токены» card.
 *
 *   - an empty field keeps the stored value (a typed-and-cleared input used
 *     to blank the token or the webhook secret and silence the bot);
 *   - a new token is checked with getMe; a wrong one is refused with a
 *     clear error and nothing is saved;
 *   - the webhook is re-registered with a fresh server-generated secret
 *     BEFORE saving, so the bot receives messages at once, and a refusal
 *     leaves the current bot intact;
 *   - username and webhook secret can no longer be typed;
 *   - without a bot, production sends fail with a reason instead of being
 *     counted as delivered.
 */
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://neurofax.uz";
  process.env.APP_SECRET = "test-app-secret";
});

const h = vi.hoisted(() => ({
  passwordHash: "",
  clinic: {} as Record<string, unknown>,
  collision: null as null | { slug: string },
  updates: [] as Array<Record<string, unknown>>,
  getMe: vi.fn(),
  setWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  setChatMenuButton: vi.fn(),
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
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ id: "u1", passwordHash: h.passwordHash })) },
    clinic: {
      findUnique: vi.fn(async () => ({ ...h.clinic })),
      findFirst: vi.fn(async () => h.collision),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data);
        return {};
      }),
    },
  },
}));
vi.mock("@/server/telegram/bot-api", () => ({
  getMe: h.getMe,
  setWebhook: h.setWebhook,
  deleteWebhook: h.deleteWebhook,
  setChatMenuButton: h.setChatMenuButton,
}));

import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { readTgBotToken } from "@/server/crypto/secret-fields";
import { ClinicSecretsSchema } from "@/server/schemas/settings";
import {
  LogOnlyTgAdapter,
  TG_BOT_NOT_CONNECTED,
} from "@/server/notifications/adapters/tg-log-only";
import { POST } from "@/app/api/crm/clinic/secrets/route";

const NEW_TOKEN = "123456789:AAH-new_token_value_1234567890abc";

function submit(body: Record<string, unknown>) {
  return POST(
    new Request("https://x/api/crm/clinic/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "admin-password", ...body }),
    }),
  );
}

beforeEach(async () => {
  __resetRateLimitsForTests();
  h.passwordHash = await bcrypt.hash("admin-password", 4);
  h.clinic = {
    id: "c1",
    slug: "neurofax",
    tgBotToken: "987:OLD-token-value-abcdefghijklmnop",
    tgBotUsername: "neurofax_bot",
  };
  h.collision = null;
  h.updates = [];
  h.getMe.mockReset().mockResolvedValue({
    ok: true,
    result: { id: 1, is_bot: true, first_name: "NF", username: "neurofax_bot" },
  });
  h.setWebhook.mockReset().mockResolvedValue({ ok: true, result: true });
  h.deleteWebhook.mockReset().mockResolvedValue({ ok: true, result: true });
  h.setChatMenuButton.mockReset().mockResolvedValue({ ok: true, result: true });
});

describe("POST /api/crm/clinic/secrets", () => {
  it("an empty or blank field changes nothing", async () => {
    for (const tgBotToken of ["", "   ", null]) {
      const res = await submit({ tgBotToken });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: false });
    }
    expect(h.updates).toHaveLength(0);
    expect(h.getMe).not.toHaveBeenCalled();
  });

  it("username and webhook secret cannot be typed any more", async () => {
    const parsed = ClinicSecretsSchema.parse({
      currentPassword: "x",
      tgBotUsername: "",
      tgWebhookSecret: "",
    });
    expect(parsed).toEqual({ currentPassword: "x" });
    const res = await submit({ tgBotUsername: "", tgWebhookSecret: "" });
    expect(await res.json()).toEqual({ updated: false });
    expect(h.updates).toHaveLength(0);
  });

  it("a token Telegram rejects is refused and nothing is saved", async () => {
    h.getMe.mockResolvedValue({ ok: false, error_code: 401, description: "Unauthorized" });
    const res = await submit({ tgBotToken: NEW_TOKEN });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_token" });
    expect(h.setWebhook).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("a malformed token never reaches Telegram", async () => {
    const res = await submit({ tgBotToken: "not a token" });
    expect(res.status).toBe(400);
    expect(h.getMe).not.toHaveBeenCalled();
  });

  it("a bot serving another clinic is refused", async () => {
    h.collision = { slug: "other" };
    const res = await submit({ tgBotToken: NEW_TOKEN });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "bot_in_use" });
    expect(h.updates).toHaveLength(0);
  });

  it("re-registers the webhook with a fresh secret, then saves token, username and secret", async () => {
    const res = await submit({ tgBotToken: `  ${NEW_TOKEN}  ` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: true, botUsername: "neurofax_bot" });

    expect(h.setWebhook).toHaveBeenCalledTimes(1);
    const [token, params] = h.setWebhook.mock.calls[0]!;
    expect(token).toBe(NEW_TOKEN);
    expect(params.url).toBe("https://neurofax.uz/api/telegram/webhook/neurofax");
    expect(params.secret_token).toMatch(/^[0-9a-f]{64}$/);

    const saved = h.updates[0]!;
    expect(saved.tgWebhookSecret).toBe(params.secret_token);
    expect(saved.tgBotUsername).toBe("neurofax_bot");
    expect(saved.tgBotToken).not.toBe(NEW_TOKEN); // encrypted at rest
    expect(readTgBotToken(saved.tgBotToken as string)).toBe(NEW_TOKEN);
    // Same bot: its webhook is the one just set, nothing to tear down.
    expect(h.deleteWebhook).not.toHaveBeenCalled();
  });

  it("a refused webhook leaves the current bot as it was", async () => {
    h.setWebhook.mockResolvedValue({ ok: false, error_code: 400, description: "bad" });
    const res = await submit({ tgBotToken: NEW_TOKEN });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "webhook_failed" });
    expect(h.updates).toHaveLength(0);
  });

  it("switching to another bot unhooks the previous one", async () => {
    h.getMe.mockResolvedValue({
      ok: true,
      result: { id: 2, is_bot: true, first_name: "New", username: "new_clinic_bot" },
    });
    const res = await submit({ tgBotToken: NEW_TOKEN });
    expect(res.status).toBe(200);
    expect(h.deleteWebhook).toHaveBeenCalledWith("987:OLD-token-value-abcdefghijklmnop", false);
    expect(h.updates[0]!.tgBotUsername).toBe("new_clinic_bot");
  });

  it("a wrong password saves nothing", async () => {
    const res = await POST(
      new Request("https://x/api/crm/clinic/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "nope", tgBotToken: NEW_TOKEN }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "wrong_password" });
    expect(h.getMe).not.toHaveBeenCalled();
  });
});

describe("LogOnlyTgAdapter (no bot token)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in production a send fails with a reason instead of a fake delivery", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(new LogOnlyTgAdapter().send("42", "Напоминание")).rejects.toThrow(
      TG_BOT_NOT_CONNECTED,
    );
  });

  it("outside production it still logs and returns an id (dev and tests)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await new LogOnlyTgAdapter().send("42", "Напоминание");
    expect(typeof res.messageId).toBe("number");
  });
});
