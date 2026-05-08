/**
 * Phase 15 Wave 4 — `src/server/ai/marketing-copy.ts` unit tests.
 *
 * The generator delegates the heavy lifting (PII redaction, rate limit,
 * cost) to `callLLM`. We stub the provider via the same
 * `__setLLMOverridesForTesting` seam used by Wave 1/2/3, then assert on:
 *
 *   - happy path (1./2./3. parser)
 *   - malformed responses (no numbered prefix → blank-line split)
 *   - single-line responses (single variant fallback)
 *   - over-limit variants stay verbatim with `withinLimit: false`
 *   - the `variants` count flows into the prompt (request shape capture)
 *   - default `maxChars` per channel
 *   - cost / token propagation
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
  __setLLMOverridesForTesting,
  __resetLLMOverridesForTesting,
} from "@/server/ai/llm";
import {
  generateMarketingCopy,
  parseMarketingCopyVariants,
  DEFAULT_MAX_CHARS_BY_CHANNEL,
  type MarketingCopyInput,
} from "@/server/ai/marketing-copy";

const ORIGINAL_ENV = { ...process.env };

function makeInput(
  overrides: Partial<MarketingCopyInput> = {},
): MarketingCopyInput {
  return {
    clinicId: "clinic-1",
    userId: "user-1",
    channel: "SMS",
    audience: "reactivation",
    locale: "ru",
    tone: "friendly",
    ...overrides,
  };
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Pure parser
// ─────────────────────────────────────────────────────────────────────────────

describe("parseMarketingCopyVariants", () => {
  it("splits numbered list into clean variants without prefixes", () => {
    const text = "1. Привет, давно не виделись!\n2. Скучаем!\n3. Заходите.";
    const out = parseMarketingCopyVariants(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Привет, давно не виделись!");
    expect(out[1]).toBe("Скучаем!");
    expect(out[2]).toBe("Заходите.");
  });

  it("falls back to blank-line split when no numbered prefix", () => {
    const text = "Первый вариант текста.\n\nВторой вариант текста.";
    const out = parseMarketingCopyVariants(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("Первый вариант текста.");
    expect(out[1]).toBe("Второй вариант текста.");
  });

  it("returns a single variant when nothing else parses", () => {
    const text = "Здравствуйте! Приходите.";
    const out = parseMarketingCopyVariants(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("Здравствуйте! Приходите.");
  });

  it("returns empty array for empty input", () => {
    expect(parseMarketingCopyVariants("")).toEqual([]);
    expect(parseMarketingCopyVariants("   \n  ")).toEqual([]);
  });

  it("handles multi-line numbered variants", () => {
    const text =
      "1. Первая строка варианта\nпродолжение\n2. Второй вариант\n3. Третий";
    const out = parseMarketingCopyVariants(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Первая строка варианта\nпродолжение");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateMarketingCopy — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — happy path", () => {
  it("returns 3 variants with charCount and withinLimit", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "1. Hello world!\n2. Another short copy here.\n3. Third variant.",
        toolCalls: [],
        inputTokens: 50,
        outputTokens: 30,
      }),
    });

    const result = await generateMarketingCopy(
      makeInput({ channel: "SMS", maxChars: 200 }),
    );

    expect(result.variants).toHaveLength(3);
    expect(result.variants[0].text).toBe("Hello world!");
    expect(result.variants[0].charCount).toBe("Hello world!".length);
    expect(result.variants[0].withinLimit).toBe(true);
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Malformed / fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — malformed LLM output", () => {
  it("falls back to blank-line split when no numbered prefix", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "First option here.\n\nSecond option here.\n\nThird option here.",
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 10,
      }),
    });

    const result = await generateMarketingCopy(makeInput());
    expect(result.variants).toHaveLength(3);
    expect(result.variants[0].text).toBe("First option here.");
    expect(result.variants[2].text).toBe("Third option here.");
  });

  it("returns a single variant when LLM returns one line", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "Only one variant came back.",
        toolCalls: [],
        inputTokens: 5,
        outputTokens: 5,
      }),
    });

    const result = await generateMarketingCopy(makeInput());
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].text).toBe("Only one variant came back.");
    // Doesn't crash — that's the contract.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Over-limit handling
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — over-limit variants", () => {
  it("flags withinLimit=false but does NOT truncate", async () => {
    const longText = "x".repeat(250);
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: `1. short ok\n2. ${longText}\n3. fine`,
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 10,
      }),
    });

    const result = await generateMarketingCopy(
      makeInput({ channel: "SMS", maxChars: 200 }),
    );

    expect(result.variants).toHaveLength(3);
    expect(result.variants[1].withinLimit).toBe(false);
    expect(result.variants[1].text).toBe(longText);
    expect(result.variants[1].charCount).toBe(250);
    expect(result.variants[0].withinLimit).toBe(true);
    expect(result.variants[2].withinLimit).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Variants count → prompt
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — variants count flows to prompt", () => {
  it("asks for 5 variants when input.variants = 5", async () => {
    let capturedSystem: string | undefined;
    let capturedUser: string | undefined;

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        capturedUser = req.messages[0]?.content;
        return {
          text: "1. a\n2. b\n3. c\n4. d\n5. e",
          toolCalls: [],
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    });

    const result = await generateMarketingCopy(
      makeInput({ variants: 5 }),
    );

    expect(result.variants).toHaveLength(5);
    expect(capturedSystem).toBeDefined();
    expect(capturedSystem).toContain("РОВНО 5");
    expect(capturedUser).toContain("Количество вариантов: 5");
  });

  it("clamps variants to [1..5]", async () => {
    let capturedSystem: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        return {
          text: "1. a",
          toolCalls: [],
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    });

    await generateMarketingCopy(makeInput({ variants: 99 }));
    expect(capturedSystem).toContain("РОВНО 5");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default maxChars by channel
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — default maxChars by channel", () => {
  it("SMS defaults to 200", async () => {
    let capturedSystem: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        return { text: "1. ok", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });

    await generateMarketingCopy(makeInput({ channel: "SMS" }));
    expect(capturedSystem).toContain("Лимит: 200 символов");
    expect(DEFAULT_MAX_CHARS_BY_CHANNEL.SMS).toBe(200);
  });

  it("TG defaults to 500", async () => {
    let capturedSystem: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        return { text: "1. ok", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });

    await generateMarketingCopy(makeInput({ channel: "TG" }));
    expect(capturedSystem).toContain("Лимит: 500 символов");
    expect(DEFAULT_MAX_CHARS_BY_CHANNEL.TG).toBe(500);
  });

  it("EMAIL defaults to 2000", async () => {
    let capturedSystem: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        return { text: "1. ok", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });

    await generateMarketingCopy(makeInput({ channel: "EMAIL" }));
    expect(capturedSystem).toContain("Лимит: 2000 символов");
    expect(DEFAULT_MAX_CHARS_BY_CHANNEL.EMAIL).toBe(2000);
  });

  it("explicit maxChars overrides the default", async () => {
    let capturedSystem: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        return { text: "1. ok", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });

    await generateMarketingCopy(
      makeInput({ channel: "SMS", maxChars: 90 }),
    );
    expect(capturedSystem).toContain("Лимит: 90 символов");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cost / tokens propagate
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — cost / tokens propagate", () => {
  it("forwards costUzs / inputTokens / outputTokens from LLMResponse", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "1. a\n2. b\n3. c",
        toolCalls: [],
        inputTokens: 250,
        outputTokens: 150,
      }),
    });

    const result = await generateMarketingCopy(makeInput());
    expect(typeof result.costUzs).toBe("number");
    expect(result.inputTokens).toBe(250);
    expect(result.outputTokens).toBe(150);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Promo passthrough
// ─────────────────────────────────────────────────────────────────────────────

describe("generateMarketingCopy — promo + notes passthrough", () => {
  it("includes promo and notes verbatim in user content", async () => {
    let capturedUser: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedUser = req.messages[0]?.content;
        return { text: "1. ok", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });

    await generateMarketingCopy(
      makeInput({
        promo: "20% off until Dec 31",
        customNotes: "winter season cohort",
      }),
    );

    expect(capturedUser).toContain("20% off until Dec 31");
    expect(capturedUser).toContain("winter season cohort");
  });
});
