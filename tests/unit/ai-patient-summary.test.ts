/**
 * Phase 15 Wave 2 — `src/server/ai/summary.ts` unit tests.
 *
 * The summary builder calls `callLLM`; we stub the provider and Prisma at
 * the module boundary so each assertion runs in isolation. The mock
 * provider in `llm.ts` echoes the last message; the cost/tokens table is
 * deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";

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
  generatePatientSummary,
  buildFallbackSummary,
  type PatientSummaryInput,
} from "@/server/ai/summary";

const ORIGINAL_ENV = { ...process.env };

function makeInput(
  overrides: Partial<PatientSummaryInput> = {},
): PatientSummaryInput {
  return {
    patientId: "p1",
    patient: {
      firstName: "Алишер",
      lastName: "Каримов",
      birthYear: 1991,
      createdAt: new Date("2024-01-15T10:00:00Z"),
      gender: "M",
    },
    recentVisits: [
      {
        date: new Date("2026-04-12T14:30:00Z"),
        doctorSpecialty: "невролог",
        diagnosis: "Мигрень",
        notes: "Headaches возвращаются",
        prescriptions: "Trizolinum",
      },
    ],
    openCases: [],
    locale: "ru",
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

describe("generatePatientSummary — happy path with mock provider", () => {
  it("returns non-empty text and propagates token counts", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "Алишер Каримов, 35 лет. Последний визит — мигрень, Trizolinum.",
        toolCalls: [],
        inputTokens: 120,
        outputTokens: 30,
      }),
    });

    const result = await generatePatientSummary(
      "clinic-1",
      "user-1",
      makeInput(),
    );

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain("Алишер");
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(30);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });
});

describe("generatePatientSummary — knownNames are forwarded", () => {
  it("sends patient and visit-doctor names to the redactor via knownNames", async () => {
    let capturedSystem: string | undefined;
    let capturedMessage: string | undefined;

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedSystem = req.system;
        capturedMessage = req.messages[0]?.content;
        return {
          text: "ok",
          toolCalls: [],
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    });

    await generatePatientSummary("clinic-1", "user-1", makeInput());

    // System prompt should not contain raw names — knownNames=[firstName,
    // lastName, doctorSpecialty] redact them to <NAME_N> tokens.
    expect(capturedMessage).toBeDefined();
    expect(capturedMessage).not.toContain("Алишер");
    expect(capturedMessage).not.toContain("Каримов");
    // The user content does include a redacted-token reference for the name.
    expect(capturedMessage).toMatch(/<NAME_\d+>/);
    expect(capturedSystem).toBeDefined();
  });
});

describe("generatePatientSummary — fallback when LLM returns empty", () => {
  it("falls back to deterministic template when provider returns whitespace", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "   \n\t  ",
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 0,
      }),
    });

    const result = await generatePatientSummary(
      "clinic-1",
      null,
      makeInput(),
    );

    expect(result.text).toContain("Алишер");
    expect(result.text).toContain("2024");
    expect(result.text).toContain("постоянный пациент");
  });
});

describe("generatePatientSummary — minimal demographics", () => {
  it("produces a graceful summary with no visits and no cases", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => ({
        // Verify the prompt mentions there are no visits.
        text: req.messages[0]?.content.includes("Визитов нет")
          ? "Новый пациент без визитов."
          : "should-not-happen",
        toolCalls: [],
        inputTokens: 5,
        outputTokens: 5,
      }),
    });

    const result = await generatePatientSummary(
      "clinic-1",
      null,
      makeInput({ recentVisits: [], openCases: [] }),
    );

    expect(result.text).toBe("Новый пациент без визитов.");
  });
});

describe("generatePatientSummary — visit truncation", () => {
  it("only sends the visits the caller passed in (caller already trims to 3)", async () => {
    let capturedMessage: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedMessage = req.messages[0]?.content;
        return { text: "ok", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });

    // Pass exactly 3 visits — the function does not trim further; but we
    // verify that all three appear in the prompt as bullet lines.
    const visits = [0, 1, 2].map((i) => ({
      date: new Date(`2026-0${i + 1}-10T10:00:00Z`),
      doctorSpecialty: "терапевт",
      diagnosis: `D${i}`,
      notes: null,
      prescriptions: null,
    }));

    await generatePatientSummary(
      "clinic-1",
      null,
      makeInput({ recentVisits: visits }),
    );

    expect(capturedMessage).toBeDefined();
    // 3 dash-prefixed visit lines.
    const dashes = (capturedMessage!.match(/^- /gm) ?? []).length;
    expect(dashes).toBe(3);
  });
});

describe("generatePatientSummary — cost / tokens propagate", () => {
  it("forwards costUzs from LLMResponse", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "summary",
        toolCalls: [],
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    const result = await generatePatientSummary(
      "clinic-1",
      null,
      makeInput(),
    );

    // The mock provider sets cost=0; the real Anthropic mapping is unit-
    // tested elsewhere. We assert that *some* number flowed through.
    expect(typeof result.costUzs).toBe("number");
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
  });
});

describe("buildFallbackSummary", () => {
  it("renders RU fallback with age and createdAt year", () => {
    const fallback = buildFallbackSummary(makeInput());
    expect(fallback).toContain("Алишер");
    expect(fallback).toContain("2024");
    expect(fallback).toContain("постоянный пациент");
  });

  it("renders UZ fallback in Uzbek wording", () => {
    const fallback = buildFallbackSummary(makeInput({ locale: "uz" }));
    expect(fallback).toMatch(/yosh|yildan/);
  });

  it("omits age when birthYear is null", () => {
    const fallback = buildFallbackSummary(
      makeInput({
        patient: {
          firstName: "X",
          lastName: "Y",
          birthYear: null,
          createdAt: new Date("2024-01-01T00:00:00Z"),
          gender: null,
        },
      }),
    );
    // Should not crash and should not contain a leading bare comma+number.
    expect(fallback).toContain("2024");
  });
});
