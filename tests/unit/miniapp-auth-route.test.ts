/**
 * Tests for the Mini App auth route handler — verifies that the request
 * helper rejects missing init-data / wrong slug, and accepts a properly
 * signed init-data string using the fixture clinic's bot token.
 *
 * We mock `@/lib/prisma` so these tests run without a live DB. The focus is
 * the request-handling logic (header checks, HMAC verify, JSON shape), not
 * the DB-level Patient.upsert which is exercised in tenancy-isolation.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

// In-memory "DB" for the mock.
type MockPatient = {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredLang: "RU" | "UZ";
  consentMarketing: boolean;
};
type Where = Record<string, unknown>;
const state = {
  clinic: null as null | {
    id: string;
    slug: string;
    tgBotToken: string | null;
    active: boolean;
  },
  patients: [] as MockPatient[],
  lastId: 0,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async ({ where }: { where: Where }) => {
        if (!state.clinic) return null;
        if (where.slug && where.slug !== state.clinic.slug) return null;
        return state.clinic;
      }),
    },
    patient: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => {
        return (
          state.patients.find(
            (p) =>
              (!where.clinicId || p.clinicId === where.clinicId) &&
              (!where.telegramId || p.telegramId === where.telegramId) &&
              (!where.phoneNormalized || p.phoneNormalized === where.phoneNormalized),
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: { data: Partial<MockPatient> }) => {
        state.lastId++;
        const p: MockPatient = {
          id: `p${state.lastId}`,
          clinicId: (data.clinicId as string) ?? "",
          fullName: (data.fullName as string) ?? "",
          phone: (data.phone as string) ?? "",
          phoneNormalized: (data.phoneNormalized as string) ?? "",
          telegramId: (data.telegramId as string) ?? null,
          telegramUsername: (data.telegramUsername as string) ?? null,
          preferredLang: (data.preferredLang as "RU" | "UZ") ?? "RU",
          consentMarketing: false,
        };
        state.patients.push(p);
        return p;
      }),
      update: vi.fn(
        async ({ where, data }: { where: Where; data: Partial<MockPatient> }) => {
          const p = state.patients.find((x) => x.id === where.id);
          if (!p) throw new Error("not found");
          Object.assign(p, data);
          return p;
        },
      ),
    },
  },
}));

const BOT_TOKEN = "999:testBotToken";

function signInitData(fields: Record<string, string>): string {
  const entries = Object.entries(fields)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, v);
  params.append("hash", hash);
  return params.toString();
}

async function callAuth(opts: {
  slug?: string;
  initData?: string;
  body?: unknown;
}): Promise<Response> {
  const { POST } = await import("@/app/api/miniapp/auth/route");
  const url = `https://app.local/api/miniapp/auth${
    opts.slug !== undefined ? `?clinicSlug=${opts.slug}` : ""
  }`;
  const req = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.initData !== undefined
        ? { "x-telegram-init-data": opts.initData }
        : {}),
    },
    body: JSON.stringify(opts.body ?? {}),
  });
  return POST(req);
}

describe("POST /api/miniapp/auth", () => {
  beforeEach(() => {
    state.clinic = {
      id: "c1",
      slug: "neurofax",
      tgBotToken: BOT_TOKEN,
      active: true,
    };
    state.patients = [];
    state.lastId = 0;
  });

  it("rejects when init-data header is missing", async () => {
    const res = await callAuth({ slug: "neurofax" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.reason).toBe("missing_init_data");
  });

  it("rejects when clinic slug is missing", async () => {
    const res = await callAuth({
      initData: "hash=0",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toBe("missing_clinic_slug");
  });

  it("rejects when clinic is unknown", async () => {
    const res = await callAuth({
      slug: "does-not-exist",
      initData: "hash=0",
    });
    expect(res.status).toBe(404);
  });

  it("rejects when init-data hash is invalid", async () => {
    const bad = new URLSearchParams({
      user: JSON.stringify({ id: 1 }),
      auth_date: String(Math.floor(Date.now() / 1000)),
      hash: "0".repeat(64),
    }).toString();
    const res = await callAuth({ slug: "neurofax", initData: bad });
    expect(res.status).toBe(401);
  });

  it("accepts a valid init-data and creates a patient on first call", async () => {
    const now = Math.floor(Date.now() / 1000);
    const initData = signInitData({
      user: JSON.stringify({
        id: 42,
        first_name: "Jamshid",
        username: "jamshid",
        language_code: "uz",
      }),
      auth_date: String(now),
    });
    const res = await callAuth({ slug: "neurofax", initData });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patient.fullName).toBe("Jamshid");
    expect(body.patient.telegramId).toBe("42");
    expect(body.patient.preferredLang).toBe("UZ");
    expect(body.clinic.slug).toBe("neurofax");
    // Second call must return the existing patient (idempotent).
    const res2 = await callAuth({ slug: "neurofax", initData });
    const body2 = await res2.json();
    expect(body2.patient.id).toBe(body.patient.id);
  });

  it("responds 503 when clinic bot token is not configured", async () => {
    state.clinic = {
      id: "c1",
      slug: "neurofax",
      tgBotToken: null,
      active: true,
    };
    const res = await callAuth({
      slug: "neurofax",
      initData: "hash=0",
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.reason).toBe("bot_not_configured");
  });
});
