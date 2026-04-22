/**
 * Tests for `resolveMiniAppContext` — the shared helper behind every
 * `/api/miniapp/*` route. Covers the header/slug/hash gates and the
 * "patient must already exist" 428 response.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

type Where = Record<string, unknown>;
const state = {
  clinic: null as null | {
    id: string;
    slug: string;
    tgBotToken: string | null;
    active: boolean;
  },
  patients: [] as Array<{
    id: string;
    clinicId: string;
    fullName: string;
    phone: string;
    preferredLang: "RU" | "UZ";
    telegramId: string | null;
    telegramUsername: string | null;
  }>,
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
              (!where.telegramId || p.telegramId === where.telegramId),
          ) ?? null
        );
      }),
    },
  },
}));

const BOT = "555:demoToken";

function sign(user: Record<string, unknown>, now = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = {
    user: JSON.stringify(user),
    auth_date: String(now),
  };
  const entries = Object.entries(fields)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  const params = new URLSearchParams();
  for (const [k, v] of entries) params.append(k, v);
  params.append("hash", hash);
  return params.toString();
}

async function run(opts: {
  slug?: string;
  initData?: string;
  skipPatientUpsert?: boolean;
}) {
  const mod = await import("@/server/miniapp/handler");
  const url = `https://x/api/miniapp/anything${
    opts.slug ? `?clinicSlug=${opts.slug}` : ""
  }`;
  const headers: Record<string, string> = {};
  if (opts.initData !== undefined) headers["x-telegram-init-data"] = opts.initData;
  const req = new Request(url, { headers });
  return mod.resolveMiniAppContext(req, {
    skipPatientUpsert: opts.skipPatientUpsert,
  });
}

describe("resolveMiniAppContext", () => {
  beforeEach(() => {
    state.clinic = {
      id: "c1",
      slug: "neurofax",
      tgBotToken: BOT,
      active: true,
    };
    state.patients = [];
  });

  it("rejects when init-data header is missing", async () => {
    const res = await run({ slug: "neurofax" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(401);
    }
  });

  it("rejects when slug is missing", async () => {
    const res = await run({ initData: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(400);
  });

  it("rejects when patient is not yet registered (and skipPatientUpsert=false)", async () => {
    const init = sign({ id: 100, first_name: "A" });
    const res = await run({ slug: "neurofax", initData: init });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(428);
  });

  it("returns an empty patient when skipPatientUpsert=true", async () => {
    const init = sign({ id: 100, first_name: "A" });
    const res = await run({
      slug: "neurofax",
      initData: init,
      skipPatientUpsert: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ctx.clinicSlug).toBe("neurofax");
      expect(res.ctx.tgUser.id).toBe(100);
    }
  });

  it("resolves an existing patient by telegramId", async () => {
    state.patients.push({
      id: "p1",
      clinicId: "c1",
      fullName: "Already Registered",
      phone: "+998901112233",
      preferredLang: "RU",
      telegramId: "100",
      telegramUsername: "a",
    });
    const init = sign({ id: 100, first_name: "A" });
    const res = await run({ slug: "neurofax", initData: init });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ctx.patientId).toBe("p1");
      expect(res.ctx.patient.fullName).toBe("Already Registered");
    }
  });

  it("rejects when clinic has no bot token configured", async () => {
    state.clinic = {
      id: "c1",
      slug: "neurofax",
      tgBotToken: null,
      active: true,
    };
    const res = await run({ slug: "neurofax", initData: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(503);
  });
});
