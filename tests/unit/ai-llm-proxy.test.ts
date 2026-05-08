/**
 * Phase 15 Wave 1 — `src/server/ai/llm.ts` unit tests (mock provider only).
 *
 * The proxy depends on Prisma, Redis, and the Anthropic SDK at runtime. We
 * never hit any of them here — `__setLLMOverridesForTesting` swaps in
 * in-memory stubs for the rate-limit count, the usage row writer, the audit
 * row writer, the cache, and the provider call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    lLMUsage: { count: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import {
  callLLM,
  estimateCostUzs,
  LLMRateLimitError,
  LLM_DAILY_LIMIT_BY_PLAN,
  __setLLMOverridesForTesting,
  __resetLLMOverridesForTesting,
} from "@/server/ai/llm";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.LLM_PROVIDER = "mock";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.REDIS_URL;
  __resetLLMOverridesForTesting();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  __resetLLMOverridesForTesting();
});

describe("callLLM — mock provider shape", () => {
  it("returns the canned mock-llm string and zero usage", async () => {
    let recordedUsage: unknown = null;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async (row) => {
        recordedUsage = row;
      },
      recordAudit: async () => {},
    });

    const res = await callLLM({
      clinicId: "clinic-1",
      useCase: "cmdk.search",
      messages: [{ role: "user", content: "Hello world" }],
    });

    expect(res.text.startsWith("[mock-llm: mock]")).toBe(true);
    expect(res.text).toContain("Hello world");
    expect(res.inputTokens).toBe(0);
    expect(res.outputTokens).toBe(0);
    expect(res.cacheHit).toBe(false);
    expect(res.costUzs).toBe(0);
    expect(recordedUsage).toMatchObject({
      clinicId: "clinic-1",
      useCase: "cmdk.search",
      provider: "mock",
      model: "mock",
      cacheHit: false,
      errorCode: null,
    });
  });
});

describe("callLLM — provider fallback", () => {
  it("falls back to mock and warns when ANTHROPIC_API_KEY is missing", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    const warnings: string[] = [];

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      warn: (m) => warnings.push(m),
    });

    const res = await callLLM({
      clinicId: "c1",
      useCase: "cmdk.search",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(res.text.startsWith("[mock-llm: mock]")).toBe(true);
    expect(warnings.some((m) => m.includes("ANTHROPIC_API_KEY"))).toBe(true);
  });
});

describe("callLLM — redaction is applied before send", () => {
  it("provider sees <PHONE_1>, not the real phone, and the response is unredacted", async () => {
    let providerSawSystem: string | undefined;
    let providerSawMessage: string | undefined;

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        providerSawSystem = req.system;
        providerSawMessage = req.messages[0]?.content;
        return {
          // Echo the redacted token back so we can verify unredact runs.
          text: `Got the message; phone was ${req.messages[0]?.content?.match(/<PHONE_\d+>/)?.[0] ?? "?"}.`,
          toolCalls: [],
          inputTokens: 12,
          outputTokens: 8,
        };
      },
    });

    const res = await callLLM({
      clinicId: "c1",
      useCase: "patient.summary",
      system: "Summarize for doctor. Patient: Алишер Каримов.",
      messages: [
        { role: "user", content: "Patient phone +998 90 123 45 67 — please call." },
      ],
      knownNames: ["Алишер Каримов"],
    });

    // Provider must NOT have seen raw PII.
    expect(providerSawSystem).toBeDefined();
    expect(providerSawSystem).not.toContain("Алишер Каримов");
    expect(providerSawSystem).toContain("<NAME_1>");
    expect(providerSawMessage).not.toContain("+998 90 123 45 67");
    expect(providerSawMessage).toContain("<PHONE_1>");

    // Response text must be unredacted before returning to caller.
    expect(res.text).toContain("+998 90 123 45 67");
    expect(res.text).not.toContain("<PHONE_1>");
  });
});

describe("callLLM — rate limit", () => {
  it("throws LLMRateLimitError when the basic plan budget is exhausted", async () => {
    const limit = LLM_DAILY_LIMIT_BY_PLAN.basic;
    let usageWrites = 0;
    let lastErrorCode: string | null = null;

    __setLLMOverridesForTesting({
      countRecentUsage: async () => limit, // already at the cap
      resolvePlanTier: async () => "basic",
      recordUsage: async (row) => {
        usageWrites += 1;
        lastErrorCode = row.errorCode;
      },
      recordAudit: async () => {},
    });

    await expect(
      callLLM({
        clinicId: "c1",
        useCase: "cmdk.search",
        messages: [{ role: "user", content: "blocked" }],
      }),
    ).rejects.toBeInstanceOf(LLMRateLimitError);

    expect(usageWrites).toBe(1);
    expect(lastErrorCode).toBe("rate_limit");
  });

  it("allows the call when the count is below the basic plan limit", async () => {
    const limit = LLM_DAILY_LIMIT_BY_PLAN.basic;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => limit - 1,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
    });

    const res = await callLLM({
      clinicId: "c1",
      useCase: "cmdk.search",
      messages: [{ role: "user", content: "ok" }],
    });
    expect(res.text.startsWith("[mock-llm")).toBe(true);
  });
});

describe("callLLM — cache hit", () => {
  it("serves the second identical request from cache", async () => {
    const store = new Map<string, string>();
    let providerInvocations = 0;

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      cacheGet: async (k) => store.get(k) ?? null,
      cacheSet: async (k, v) => {
        store.set(k, v);
      },
      invokeProvider: async () => {
        providerInvocations += 1;
        return {
          text: "cached response body",
          toolCalls: [],
          inputTokens: 10,
          outputTokens: 5,
        };
      },
    });

    const req = {
      clinicId: "c1" as const,
      useCase: "patient.summary" as const,
      messages: [{ role: "user" as const, content: "same prompt" }],
    };

    const first = await callLLM(req);
    expect(first.cacheHit).toBe(false);
    expect(providerInvocations).toBe(1);

    const second = await callLLM(req);
    expect(second.cacheHit).toBe(true);
    expect(providerInvocations).toBe(1); // provider not called again
    expect(second.text).toBe("cached response body");
  });
});

describe("estimateCostUzs", () => {
  it("returns 0 for unknown model", () => {
    expect(estimateCostUzs("anthropic", "fake-model", 1_000_000, 1_000_000)).toBe(0);
  });

  it("returns 0 for mock provider", () => {
    expect(estimateCostUzs("mock", "mock", 100_000, 50_000)).toBe(0);
  });

  it("computes claude-sonnet-4-6 cost at $3/M input + $15/M output → tiins", () => {
    // 1M input + 1M output = $3 + $15 = $18.
    // $18 × 12 700 UZS/USD = 228 600 soum = 22 860 000 tiins.
    const tiins = estimateCostUzs("anthropic", "claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(tiins).toBe(22_860_000);
  });

  it("computes proportionally for smaller token counts", () => {
    // 100k input + 50k output = $0.30 + $0.75 = $1.05.
    // $1.05 × 12 700 = 13 335 soum = 1 333 500 tiins.
    const tiins = estimateCostUzs("anthropic", "claude-sonnet-4-6", 100_000, 50_000);
    expect(tiins).toBe(1_333_500);
  });
});
