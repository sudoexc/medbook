/**
 * Audit AC-12 — the LLM routes refuse while AI is paused (503, nothing
 * loaded, nothing called), and say `ai_not_configured` when AI is on but
 * production has no provider key. The rule-based helpers stay open.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ ai: false }));
vi.mock("@/lib/ai-enabled", () => ({
  get AI_ENABLED() {
    return flags.ai;
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: vi.fn() } } }));

// Route harness: no session, a fixed tenant context, the body schema applied.
const routeSpies = vi.hoisted(() => ({
  askAssistant: vi.fn(),
  generateMarketingCopy: vi.fn(),
  loadReceptionAiContext: vi.fn(),
}));
vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "DOCTOR" };
  const wrap =
    (
      opts: { bodySchema?: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const raw = await request.json().catch(() => ({}));
      const parsed = opts.bodySchema ? opts.bodySchema.safeParse(raw) : { success: true, data: raw };
      if (!parsed.success) return Response.json({ error: "ValidationError" }, { status: 400 });
      return handler({ request, body: parsed.data, ctx });
    };
  return { createApiHandler: wrap, createApiListHandler: wrap };
});
vi.mock("@/server/ai/tool-loop", async (orig) => ({
  ...(await orig<typeof import("@/server/ai/tool-loop")>()),
  askAssistant: routeSpies.askAssistant,
}));
vi.mock("@/server/ai/marketing-copy", async (orig) => ({
  ...(await orig<typeof import("@/server/ai/marketing-copy")>()),
  generateMarketingCopy: routeSpies.generateMarketingCopy,
}));
vi.mock("@/app/api/crm/ai/_lib/reception-context", () => ({
  loadReceptionAiContext: routeSpies.loadReceptionAiContext,
}));

beforeEach(() => {
  flags.ai = false;
  for (const s of Object.values(routeSpies)) s.mockReset();
});

describe("AC-12: the LLM routes answer 503 while AI is paused", () => {
  const post = (url: string, body: unknown) =>
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("ask, marketing copy, conclusion, clarifying questions, ICD-10: 503 ai_disabled, nothing called", async () => {
    const cases: Array<[string, unknown]> = [
      ["ask", { question: "найди Каримову", locale: "ru" }],
      ["marketing-copy", { channel: "TG", audience: "general", locale: "ru" }],
      ["build-conclusion", { noteId: "n1" }],
      ["clarifying-questions", { noteId: "n1" }],
      ["icd10-suggest", { noteId: "n1" }],
    ];
    for (const [route, body] of cases) {
      vi.resetModules();
      const mod = (await import(`@/app/api/crm/ai/${route}/route`)) as {
        POST: (r: Request) => Promise<Response>;
      };
      const res = await mod.POST(post(`https://x/api/crm/ai/${route}`, body));
      expect(res.status, route).toBe(503);
      expect(await res.json(), route).toMatchObject({ error: "ai_disabled" });
    }
    expect(routeSpies.askAssistant).not.toHaveBeenCalled();
    expect(routeSpies.generateMarketingCopy).not.toHaveBeenCalled();
    expect(routeSpies.loadReceptionAiContext).not.toHaveBeenCalled();
  });

  it("the rule-based helpers (queue score, ETA, reassign, warnings) stay open: reception uses them daily", () => {
    for (const route of ["queue", "eta", "reassign", "warnings"]) {
      const src = readFileSync(
        path.join(process.cwd(), `src/app/api/crm/ai/${route}/route.ts`),
        "utf8",
      );
      expect(src, route).not.toContain("ai_disabled");
      expect(src, route).not.toContain("availability");
    }
  });

  it("with AI on and no key in production, ask says ai_not_configured (not 500, not a mock)", async () => {
    flags.ai = true;
    vi.resetModules();
    // The error class of the fresh module graph the route will load.
    const { AIProviderNotConfiguredError } = await import("@/server/ai/availability");
    routeSpies.askAssistant.mockRejectedValue(new AIProviderNotConfiguredError("LLM provider"));
    const { POST } = await import("@/app/api/crm/ai/ask/route");
    const res = await POST(post("https://x/api/crm/ai/ask", { question: "кто сегодня", locale: "ru" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "ai_not_configured" });
  });
});
