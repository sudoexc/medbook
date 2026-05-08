/**
 * Phase 15 Wave 5 — `src/server/ai/soap.ts` unit tests.
 *
 * Same harness pattern as `ai-patient-summary.test.ts`: mock Prisma at the
 * module boundary so `callLLM` can write usage/audit rows without a real
 * database, then plug into the LLM proxy via `__setLLMOverridesForTesting`.
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
  parseSoapSections,
  stitchSoapMarkdown,
  structureSoap,
  type SoapStructureInput,
} from "@/server/ai/soap";

const ORIGINAL_ENV = { ...process.env };

function makeInput(
  overrides: Partial<SoapStructureInput> = {},
): SoapStructureInput {
  return {
    clinicId: "clinic-1",
    userId: "user-1",
    caseId: "case-1",
    transcriptText:
      "Пациент жалуется на головную боль три дня. Давление 130 на 80. Назначил парацетамол.",
    patientContext: { fullName: "Алишер Каримов", birthYear: 1991 },
    locale: "ru",
    ...overrides,
  };
}

const WELL_FORMED = [
  "### Subjective",
  "Жалобы на головную боль три дня.",
  "",
  "### Objective",
  "АД 130/80, ЧСС 78.",
  "",
  "### Assessment",
  "Головная боль напряжения.",
  "",
  "### Plan",
  "Парацетамол 500мг при болях.",
].join("\n");

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
// parseSoapSections
// ─────────────────────────────────────────────────────────────────────────────

describe("parseSoapSections", () => {
  it("splits a well-formed response into four sections", () => {
    const r = parseSoapSections(WELL_FORMED);
    expect(r.ok).toBe(true);
    expect(r.subjective).toContain("головную боль");
    expect(r.objective).toContain("АД 130/80");
    expect(r.assessment).toContain("напряжения");
    expect(r.plan).toContain("Парацетамол");
  });

  it("accepts case-insensitive headers and trailing punctuation", () => {
    const text = [
      "## subjective:",
      "complaint",
      "## OBJECTIVE.",
      "examined",
      "## Assessment",
      "diagnosis",
      "## Plan",
      "rx",
    ].join("\n");
    const r = parseSoapSections(text);
    expect(r.ok).toBe(true);
    expect(r.subjective).toBe("complaint");
    expect(r.objective).toBe("examined");
    expect(r.assessment).toBe("diagnosis");
    expect(r.plan).toBe("rx");
  });

  it("returns ok=false for empty text", () => {
    const r = parseSoapSections("");
    expect(r.ok).toBe(false);
    expect(r.subjective).toBe("");
  });

  it("returns ok=false when no headers match", () => {
    const r = parseSoapSections("just a freeform paragraph with no headers");
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stitchSoapMarkdown
// ─────────────────────────────────────────────────────────────────────────────

describe("stitchSoapMarkdown", () => {
  it("emits all four headers even when sections are empty", () => {
    const md = stitchSoapMarkdown({
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
    });
    expect(md).toContain("### Subjective");
    expect(md).toContain("### Objective");
    expect(md).toContain("### Assessment");
    expect(md).toContain("### Plan");
  });

  it("round-trips parse → stitch → parse", () => {
    const parts = parseSoapSections(WELL_FORMED);
    const md = stitchSoapMarkdown(parts);
    const reparsed = parseSoapSections(md);
    expect(reparsed.ok).toBe(true);
    expect(reparsed.subjective).toBe(parts.subjective);
    expect(reparsed.plan).toBe(parts.plan);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// structureSoap — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("structureSoap — well-formed response", () => {
  it("returns parsed sections plus token / cost fields", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: WELL_FORMED,
        toolCalls: [],
        inputTokens: 200,
        outputTokens: 100,
      }),
    });

    const r = await structureSoap(makeInput());

    expect(r.subjective).toContain("головную боль");
    expect(r.objective).toContain("АД 130/80");
    expect(r.assessment).toContain("напряжения");
    expect(r.plan).toContain("Парацетамол");
    expect(r.inputTokens).toBe(200);
    expect(r.outputTokens).toBe(100);
    expect(typeof r.costUzs).toBe("number");
    expect(r.raw).toContain("### Subjective");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// structureSoap — fallback when LLM output isn't structured
// ─────────────────────────────────────────────────────────────────────────────

describe("structureSoap — malformed LLM response", () => {
  it("dumps the whole text into subjective so the doctor still sees something", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => ({
        text: "no headers here, just some prose about the patient",
        toolCalls: [],
        inputTokens: 50,
        outputTokens: 20,
      }),
    });

    const r = await structureSoap(makeInput());
    expect(r.subjective).toContain("just some prose");
    expect(r.objective).toBe("");
    expect(r.assessment).toBe("");
    expect(r.plan).toBe("");
    expect(r.raw).toContain("just some prose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// structureSoap — empty transcript still returns gracefully
// ─────────────────────────────────────────────────────────────────────────────

describe("structureSoap — empty transcript", () => {
  it("does not crash when transcriptText is whitespace", async () => {
    let capturedMessage: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "basic",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedMessage = req.messages[0]?.content;
        return {
          text: "",
          toolCalls: [],
          inputTokens: 5,
          outputTokens: 0,
        };
      },
    });

    const r = await structureSoap(makeInput({ transcriptText: "   " }));
    expect(capturedMessage).toContain("[пустая расшифровка]");
    // Empty LLM output → empty parser → still returns the empty struct,
    // not a crash.
    expect(r.subjective).toBe("");
    expect(r.raw).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// structureSoap — knownNames forwarded to redactor
// ─────────────────────────────────────────────────────────────────────────────

describe("structureSoap — knownNames are forwarded", () => {
  it("redacts the patient's name from the user content", async () => {
    let capturedMessage: string | undefined;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        capturedMessage = req.messages[0]?.content;
        return {
          text: WELL_FORMED,
          toolCalls: [],
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    });

    await structureSoap(
      makeInput({
        transcriptText:
          "Пациент Алишер Каримов жалуется на головную боль три дня.",
      }),
    );

    expect(capturedMessage).toBeDefined();
    expect(capturedMessage).not.toContain("Алишер");
    expect(capturedMessage).not.toContain("Каримов");
    expect(capturedMessage).toMatch(/<NAME_\d+>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// structureSoap — LLM error returns empty graceful result
// ─────────────────────────────────────────────────────────────────────────────

describe("structureSoap — LLM throws", () => {
  it("returns empty SOAP, raw=='' when callLLM rejects", async () => {
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async () => {
        throw new Error("rate_limit");
      },
    });

    const r = await structureSoap(makeInput());
    expect(r.raw).toBe("");
    expect(r.subjective).toBe("");
    expect(r.objective).toBe("");
    expect(r.assessment).toBe("");
    expect(r.plan).toBe("");
    expect(r.costUzs).toBe(0);
  });
});
