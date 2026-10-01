/**
 * Audit ST-08: the bot's greeting and the «Авто-сообщения» widget.
 *
 *   - the greeting is sent verbatim, so a `{{…}}` in it is refused in every
 *     editor (it reached patients as «Здравствуйте, {{patient.firstName}}!»);
 *   - the widget writes the Uzbek text too (it saved `bodyRu` only);
 *   - the greeting goes out in the sender's language, and its default uses
 *     the clinic's own name instead of a hard-coded «Neurofax».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  templates: {} as Record<string, Record<string, unknown>>,
  byId: null as null | Record<string, unknown>,
  updates: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
  created: [] as Array<Record<string, unknown>>,
  clinic: { nameRu: "Клиника Мадина", nameUz: "Madina klinikasi" },
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
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/prisma", () => {
  const notificationTemplate = {
    findMany: vi.fn(async () => Object.values(h.templates)),
    findUnique: vi.fn(
      async ({ where }: { where: { id?: string; clinicId_key?: { key: string } } }) => {
        if (where.id) return h.byId;
        return h.templates[where.clinicId_key!.key] ?? null;
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { clinicId_key?: { key: string } }; data: Record<string, unknown> }) => {
        h.updates.push({ where, data });
        const key = where.clinicId_key?.key;
        if (key) Object.assign(h.templates[key]!, data);
        return { ...(key ? h.templates[key] : h.byId), ...data };
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      h.created.push(data);
      return data;
    }),
    createMany: vi.fn(async () => ({ count: 0 })),
  };
  return {
    prisma: {
      notificationTemplate,
      clinic: { findUnique: vi.fn(async () => h.clinic) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ notificationTemplate })),
    },
  };
});

import {
  allowedKeysForTemplate,
  verbatimPlaceholderLeak,
} from "@/server/notifications/rules";
import {
  defaultWelcomeBodies,
  readWelcomeConfig,
} from "@/server/notifications/auto-messages";
import { PATCH as autoMessagesPatch } from "@/app/api/crm/settings/auto-messages/route";
import { PATCH as settingsTemplatePatch } from "@/app/api/crm/settings/notifications/templates/[id]/route";
import { PATCH as centerTemplatePatch } from "@/app/api/crm/notifications/templates/[id]/route";
import { POST as centerTemplateCreate } from "@/app/api/crm/notifications/templates/route";

function json(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const welcomeRow = {
  id: "t-welcome",
  key: "patient.welcome",
  trigger: "MANUAL",
  triggerConfig: null,
  isActive: true,
  bodyRu: "Здравствуйте!",
  bodyUz: "Assalomu alaykum!",
};

beforeEach(() => {
  h.templates = {
    "patient.welcome": { ...welcomeRow },
    "appointment.reminder-24h": {
      key: "appointment.reminder-24h",
      isActive: true,
      bodyRu: "Напоминаем: {{appointment.time}}",
      bodyUz: "Eslatma: {{appointment.time}}",
    },
    "appointment.thank-you": {
      key: "appointment.thank-you",
      isActive: true,
      bodyRu: "Спасибо",
      bodyUz: "Rahmat",
    },
  };
  h.byId = { ...welcomeRow };
  h.updates = [];
  h.created = [];
});

describe("placeholder whitelist for the greeting", () => {
  it("allows none for patient.welcome, even though its trigger is MANUAL", () => {
    expect(allowedKeysForTemplate(welcomeRow)).toEqual([]);
    expect(
      allowedKeysForTemplate({ key: "promo.spring", trigger: "MANUAL", triggerConfig: null }).length,
    ).toBeGreaterThan(0);
  });

  it("names what would leak", () => {
    expect(verbatimPlaceholderLeak("patient.welcome", ["Привет, {{patient.firstName}}!"])).toEqual([
      "patient.firstName",
    ]);
    expect(verbatimPlaceholderLeak("patient.welcome", ["Привет!", null])).toBeNull();
    expect(verbatimPlaceholderLeak("promo.spring", ["{{patient.firstName}}"])).toBeNull();
  });
});

describe("every editor refuses {{…}} in the greeting", () => {
  it("Настройки → Уведомления", async () => {
    const res = await settingsTemplatePatch(
      json("PATCH", "https://x/api/crm/settings/notifications/templates/t-welcome", {
        bodyRu: "Здравствуйте, {{patient.firstName}}!",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "UnknownPlaceholder", allowed: [] });
    expect(h.updates).toHaveLength(0);
  });

  it("the notification center's template form", async () => {
    const res = await centerTemplatePatch(
      json("PATCH", "https://x/api/crm/notifications/templates/t-welcome", {
        bodyUz: "Salom, {{patient.firstName}}!",
      }),
    );
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);

    const created = await centerTemplateCreate(
      json("POST", "https://x/api/crm/notifications/templates", {
        key: "patient.welcome",
        nameRu: "Привет",
        nameUz: "Salom",
        channel: "TG",
        category: "TRANSACTIONAL",
        bodyRu: "Здравствуйте, {{patient.name}}",
        bodyUz: "Salom",
      }),
    );
    expect(created.status).toBe(400);
    expect(h.created).toHaveLength(0);
  });

  it("plain text still saves", async () => {
    const res = await centerTemplatePatch(
      json("PATCH", "https://x/api/crm/notifications/templates/t-welcome", {
        bodyRu: "Здравствуйте! Мы на связи.",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/crm/settings/auto-messages", () => {
  it("writes the Uzbek text next to the Russian one", async () => {
    const res = await autoMessagesPatch(
      json("PATCH", "https://x/api/crm/settings/auto-messages", {
        messages: [
          {
            kind: "reminder",
            text: "Ждём вас в {{appointment.time}}, новый адрес: Чиланзар 5",
            textUz: "Sizni {{appointment.time}} da kutamiz, yangi manzil: Chilonzor 5",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(h.updates[0]!.data).toEqual({
      bodyRu: "Ждём вас в {{appointment.time}}, новый адрес: Чиланзар 5",
      bodyUz: "Sizni {{appointment.time}} da kutamiz, yangi manzil: Chilonzor 5",
    });
    const body = await res.json();
    const reminder = body.messages.find((m: { kind: string }) => m.kind === "reminder");
    expect(reminder.textUz).toContain("Chilonzor 5");
  });

  it("refuses a placeholder in the Uzbek greeting as well", async () => {
    const res = await autoMessagesPatch(
      json("PATCH", "https://x/api/crm/settings/auto-messages", {
        messages: [{ kind: "welcome", textUz: "Salom, {{patient.firstName}}" }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "textUz", unknown: ["patient.firstName"] });
    expect(h.updates).toHaveLength(0);
  });
});

describe("the greeting the bot sends", () => {
  it("is the stored text in the sender's language", async () => {
    expect(await readWelcomeConfig("c1", "uz")).toEqual({
      enabled: true,
      text: "Assalomu alaykum!",
    });
    expect(await readWelcomeConfig("c1", "ru")).toEqual({ enabled: true, text: "Здравствуйте!" });
  });

  it("without a stored row, greets with the clinic's own name", async () => {
    delete h.templates["patient.welcome"];
    const ru = await readWelcomeConfig("c1", "ru");
    expect(ru?.text).toContain("Клиника Мадина");
    const uz = await readWelcomeConfig("c1", "uz");
    expect(uz?.text).toContain("Madina klinikasi");
  });

  it("the default names no other clinic and has no dashes", () => {
    const { ru, uz } = defaultWelcomeBodies({ nameRu: "Клиника Мадина", nameUz: "" });
    for (const text of [ru, uz]) {
      expect(text).not.toMatch(/Neurofax/i);
      expect(text).not.toMatch(/[—–]/);
    }
    expect(uz).toContain("Клиника Мадина"); // falls back to the Russian name
  });
});
