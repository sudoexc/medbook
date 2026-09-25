import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit MA-03 — public clinic self-signup was a mock that looked finished:
 * the confirm token came back in the POST response, so anyone could create a
 * clinic tenant and an ADMIN on production under any email.
 *
 *   - off unless PUBLIC_SIGNUP_ENABLED=1: both endpoints answer 404 and the
 *     /signup pages are not found;
 *   - when on, the response never carries the token; the link goes out by
 *     email only, and production without email delivery refuses;
 *   - per-IP rate limit.
 */

const h = vi.hoisted(() => ({
  created: [] as Array<{ id: string; token: string }>,
  deleted: [] as string[],
  sent: [] as Array<{ to: string; subject: string; html: string }>,
  sendFails: false,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => null) },
    clinicSignupToken: {
      create: vi.fn(async ({ data }: { data: { token: string } }) => {
        const row = { id: `t${h.created.length + 1}`, token: data.token };
        h.created.push(row);
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        h.deleted.push(where.id);
        return {};
      }),
      findUnique: vi.fn(async () => null),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({
  sendSignupConfirmEmail: vi.fn(async (m: { to: string; subject: string; html: string }) => {
    if (h.sendFails) throw new Error("smtp down");
    h.sent.push(m);
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { POST as signup } from "@/app/api/public/signup/route";
import { POST as confirm } from "@/app/api/public/signup/confirm/route";
import SignupPage from "@/app/[locale]/signup/page";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";
import { renderSignupConfirmEmail } from "@/lib/public-signup";

const ENV_KEYS = ["PUBLIC_SIGNUP_ENABLED", "SMTP_USER", "SMTP_PASS", "NODE_ENV", "NEXT_PUBLIC_APP_URL"] as const;
let saved: Record<string, string | undefined> = {};

function req(body: unknown, ip = "198.51.100.30") {
  return new Request("https://neurofax.uz/api/public/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}
const valid = { clinicName: "Клиника <Х>", email: "owner@clinic.uz", preferredLocale: "ru" };

function setEnv(k: (typeof ENV_KEYS)[number], v: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (v === undefined) delete env[k];
  else env[k] = v;
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  h.created = [];
  h.deleted = [];
  h.sent = [];
  h.sendFails = false;
  __resetRateLimitsForTests();
  setEnv("PUBLIC_SIGNUP_ENABLED", undefined);
  setEnv("NEXT_PUBLIC_APP_URL", "https://neurofax.uz");
});
afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

describe("switched off (the default)", () => {
  it("POST /api/public/signup and /confirm answer 404 and create nothing", async () => {
    expect((await signup(req(valid))).status).toBe(404);
    const c = await confirm(
      new Request("https://neurofax.uz/api/public/signup/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "x".repeat(32) }),
      }),
    );
    expect(c.status).toBe(404);
    expect(h.created).toHaveLength(0);
  });

  it("the /signup page is not found", async () => {
    await expect(SignupPage({ params: Promise.resolve({ locale: "ru" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("switched on", () => {
  beforeEach(() => {
    setEnv("PUBLIC_SIGNUP_ENABLED", "1");
    setEnv("SMTP_USER", "robot@neurofax.uz");
    setEnv("SMTP_PASS", "secret");
  });

  it("never returns the token; the link goes out by email only", async () => {
    const r = await signup(req(valid));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain(h.created[0]!.token);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.to).toBe("owner@clinic.uz");
    expect(h.sent[0]!.html).toContain(`https://neurofax.uz/signup/confirm/${h.created[0]!.token}`);
  });

  it("if the email cannot be sent, the token is withdrawn", async () => {
    h.sendFails = true;
    const r = await signup(req(valid));
    expect(r.status).toBe(503);
    expect(h.deleted).toEqual([h.created[0]!.id]);
  });

  it("production without email delivery refuses instead of minting an unreachable token", async () => {
    setEnv("SMTP_USER", undefined);
    setEnv("NODE_ENV", "production");
    const r = await signup(req(valid));
    expect(r.status).toBe(503);
    expect(h.created).toHaveLength(0);
  });

  it("is rate-limited per client IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await signup(req({ ...valid, email: `o${i}@clinic.uz` }))).status);
    }
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("the email is localised and escapes the clinic name", () => {
    const ru = renderSignupConfirmEmail({ locale: "ru", clinicName: "Клиника <Х>", confirmUrl: "https://x/c/t" });
    expect(ru.subject).toContain("Клиника <Х>");
    expect(ru.html).toContain("Клиника &lt;Х&gt;");
    expect(ru.html).not.toContain("<Х>");
    const uz = renderSignupConfirmEmail({ locale: "uz", clinicName: "A", confirmUrl: "https://x/c/t" });
    expect(uz.subject).not.toBe(ru.subject);
  });
});
