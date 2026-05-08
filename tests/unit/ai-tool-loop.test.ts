/**
 * Phase 15 Wave 3 — `src/server/ai/tool-loop.ts` unit tests.
 *
 * The loop wraps `callLLM` and the tool registry. We mock the LLM proxy with
 * `__setLLMOverridesForTesting` so each `callLLM` invocation can return a
 * pre-canned `toolCalls` block, and we override the registry by mocking the
 * `./tools` module to point at hand-rolled stubs.
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
  type LLMResponse,
} from "@/server/ai/llm";
import { askAssistant } from "@/server/ai/tool-loop";
import * as toolsModule from "@/server/ai/tools";

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
  vi.restoreAllMocks();
});

function makeProvider(
  responses: Array<Partial<LLMResponse> & { text?: string }>,
) {
  const calls: number[] = [];
  let i = 0;
  return {
    invokeProvider: async (): Promise<{
      text: string;
      toolCalls?: { name: string; input: unknown }[];
      inputTokens: number;
      outputTokens: number;
    }> => {
      calls.push(i);
      const r = responses[i] ?? responses[responses.length - 1] ?? {};
      i++;
      return {
        text: r.text ?? "",
        toolCalls: r.toolCalls,
        inputTokens: r.inputTokens ?? 1,
        outputTokens: r.outputTokens ?? 1,
      };
    },
    callsRef: () => calls,
  };
}

describe("askAssistant — tool execution + final answer", () => {
  it("executes a tool call, feeds summary back, returns final assistant text", async () => {
    // Stub the registry: one tool that returns a known summary + chips.
    const executeSpy = vi
      .spyOn(toolsModule, "executeTool")
      .mockResolvedValue({
        ok: true,
        data: { fake: true },
        summary: "found 2 free slots",
        chips: [
          { kind: "slot", label: "Dr A · 14:00", deeplink: "/crm/calendar?d=a" },
        ],
      });
    vi.spyOn(toolsModule, "getToolDescriptors").mockReturnValue([
      {
        name: "findFreeSlots",
        description: "stub",
        input_schema: { type: "object" },
      },
    ]);

    const provider = makeProvider([
      {
        text: "",
        toolCalls: [
          { name: "findFreeSlots", input: { specialty: "невролог" } },
        ],
      },
      { text: "Свободно у Dr A в 14:00.", toolCalls: [] },
    ]);

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: provider.invokeProvider,
    });

    const res = await askAssistant({
      clinicId: "c1",
      userId: "u1",
      locale: "ru",
      question: "найди окно у невролога",
    });

    expect(res.answer).toBe("Свободно у Dr A в 14:00.");
    expect(res.chips).toHaveLength(1);
    expect(res.chips[0]!.deeplink).toContain("/crm/calendar");
    expect(res.toolTrace).toEqual([
      {
        name: "findFreeSlots",
        input: { specialty: "невролог" },
        ok: true,
      },
    ]);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(provider.callsRef().length).toBe(2);
  });
});

describe("askAssistant — chip aggregation across multiple tool calls", () => {
  it("merges chips from two sequential tool calls into the final result", async () => {
    let nthCall = 0;
    vi.spyOn(toolsModule, "executeTool").mockImplementation(
      async (name: string) => {
        nthCall++;
        if (name === "findPatient") {
          return {
            ok: true,
            data: {},
            summary: "found patient",
            chips: [{ kind: "patient", label: "Karimov", deeplink: "/crm/patients/p1" }],
          };
        }
        return {
          ok: true,
          data: {},
          summary: "found 1 action",
          chips: [{ kind: "action", label: "No-show risk", deeplink: "/crm/action-center" }],
        };
      },
    );
    vi.spyOn(toolsModule, "getToolDescriptors").mockReturnValue([]);

    const provider = makeProvider([
      {
        text: "",
        toolCalls: [{ name: "findPatient", input: { query: "kar" } }],
      },
      {
        text: "",
        toolCalls: [{ name: "searchActions", input: {} }],
      },
      { text: "Готово.", toolCalls: [] },
    ]);

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: provider.invokeProvider,
    });

    const res = await askAssistant({
      clinicId: "c1",
      userId: "u1",
      locale: "ru",
      question: "найди Karimova и риски",
    });

    expect(res.chips).toHaveLength(2);
    expect(res.chips.map((c) => c.kind).sort()).toEqual(["action", "patient"]);
    expect(nthCall).toBe(2);
  });
});

describe("askAssistant — max iterations bound", () => {
  it("stops after MAX_ITERATIONS even if the LLM keeps requesting tools", async () => {
    vi.spyOn(toolsModule, "executeTool").mockResolvedValue({
      ok: true,
      data: {},
      summary: "still no answer",
      chips: [],
    });
    vi.spyOn(toolsModule, "getToolDescriptors").mockReturnValue([]);

    // Always respond with another tool call. The loop must give up.
    const provider = makeProvider([
      {
        text: "thinking",
        toolCalls: [{ name: "findFreeSlots", input: {} }],
      },
    ]);

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: provider.invokeProvider,
    });

    const res = await askAssistant({
      clinicId: "c1",
      userId: "u1",
      locale: "ru",
      question: "loop forever",
    });

    // 4 iterations × 1 LLM call each = 4 calls.
    expect(provider.callsRef().length).toBe(4);
    expect(res.toolTrace).toHaveLength(4);
    // We still produce *some* answer, even if the loop bailed.
    expect(typeof res.answer).toBe("string");
    expect(res.answer.length).toBeGreaterThan(0);
  });
});

describe("askAssistant — tool error handling", () => {
  it("survives a thrown tool error: trace shows ok=false, loop continues", async () => {
    let firstCall = true;
    vi.spyOn(toolsModule, "executeTool").mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error("DB connection lost");
      }
      return {
        ok: true,
        data: {},
        summary: "second tool ok",
        chips: [],
      };
    });
    vi.spyOn(toolsModule, "getToolDescriptors").mockReturnValue([]);

    const provider = makeProvider([
      {
        text: "",
        toolCalls: [{ name: "findFreeSlots", input: {} }],
      },
      {
        text: "",
        toolCalls: [{ name: "findPatient", input: { query: "x" } }],
      },
      { text: "OK", toolCalls: [] },
    ]);

    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: provider.invokeProvider,
    });

    const res = await askAssistant({
      clinicId: "c1",
      userId: "u1",
      locale: "ru",
      question: "test errors",
    });

    expect(res.toolTrace[0]!.ok).toBe(false);
    expect(res.toolTrace[1]!.ok).toBe(true);
    expect(res.answer).toBe("OK");
  });
});
