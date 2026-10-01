/**
 * Audit MA-06: the QR codes printed on paper never opened.
 *
 *   - /v/<token> (document authenticity, on every conclusion and referral)
 *     and /t/<code> (queue ticket short link) were not excluded from the
 *     proxy matcher, so next-intl rewrote them to /ru/v/… and /ru/t/…, where
 *     no route exists: 404 on every scan.
 *   - /v/<token> read the tenant-scoped Document model with no tenant
 *     context, and the fail-closed Prisma extension threw: 500.
 *
 * The matcher is checked the way Next applies it (anchored at the path
 * start), and the verify route must run its lookup in an explicit UNSCOPED
 * context, like /api/verify/recipe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTenant, type TenantContext } from "@/lib/tenant-context";

const state = vi.hoisted(() => ({
  seenTenant: undefined as unknown,
  doc: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      findFirst: vi.fn(async () => {
        state.seenTenant = getTenant();
        return state.doc;
      }),
    },
  },
}));

// The proxy's own imports are irrelevant to its static matcher.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("next-intl/middleware", () => ({ default: () => () => null }));
vi.mock("@/server/auth/user-session", () => ({ SESSION_COOKIE_NAME: "crm_user_session" }));
vi.mock("@/server/auth/security-policy", () => ({ requiresTotpEnrollment: () => false }));

import { config } from "@/proxy";
import { GET as verifyDocument } from "@/app/v/[token]/route";

function proxyRuns(pathname: string): boolean {
  return config.matcher.some((m) => new RegExp(`^${m}$`).test(pathname));
}

beforeEach(() => {
  state.seenTenant = undefined;
  state.doc = null;
});

describe("proxy matcher", () => {
  it("leaves the paper QR routes to their own handlers", () => {
    expect(proxyRuns("/v/AbCdEf0123456789_-xyz")).toBe(false);
    expect(proxyRuns("/t/K7M2QX")).toBe(false);
  });

  it("still runs on the localized site and staff pages", () => {
    expect(proxyRuns("/")).toBe(true);
    expect(proxyRuns("/crm/appointments")).toBe(true);
    expect(proxyRuns("/uz/crm")).toBe(true);
    expect(proxyRuns("/doctor/reception")).toBe(true);
    expect(proxyRuns("/doctors")).toBe(true);
    expect(proxyRuns("/terms")).toBe(true);
  });

  it("keeps the earlier exclusions", () => {
    expect(proxyRuns("/c/neurofax/my")).toBe(false);
    expect(proxyRuns("/q/token")).toBe(false);
    expect(proxyRuns("/tv/d/1")).toBe(false);
    expect(proxyRuns("/api/health")).toBe(false);
  });
});

describe("GET /v/[token]", () => {
  it("looks the document up in an explicit UNSCOPED context and vouches for it", async () => {
    state.doc = {
      type: "CONCLUSION",
      number: "NF-2026-000123",
      createdAt: new Date("2026-09-20T06:00:00Z"),
      clinic: { nameRu: "NeuroFax", phone: "+998 71 200 00 00" },
      patient: { fullName: "Каримова Дилноза Алишеровна" },
      visitNote: {
        finalizedAt: new Date("2026-09-20T07:00:00Z"),
        doctor: { nameRu: "Султанов Азиз" },
      },
      referral: null,
    };
    const res = await verifyDocument(new Request("https://neurofax.uz/v/tok_123"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ПОДЛИННЫЙ ДОКУМЕНТ");
    expect(html).toContain("NF-2026-000123");
    // Masked to initials, never the full name.
    expect(html).toContain("Каримова Д. А.");
    expect(html).not.toContain("Дилноза");
    const tenant = state.seenTenant as TenantContext | undefined;
    expect(tenant?.kind).toBe("UNSCOPED");
  });

  it("answers 404, not 500, for an unknown token", async () => {
    const res = await verifyDocument(
      new Request("https://neurofax.uz/v/nope", { headers: { accept: "application/json" } }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "not_found" });
    expect((state.seenTenant as TenantContext | undefined)?.kind).toBe("UNSCOPED");
  });
});
