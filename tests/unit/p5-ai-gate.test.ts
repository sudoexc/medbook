/**
 * Audits AC-12 and AC-13 — the AI switch acts on the server, not only on the
 * interface.
 *
 *   - AC-12: with AI paused every LLM route answers 503 and nothing reaches
 *     the provider or the usage log; production without a provider key is an
 *     error, never a mock answer; the NL assistant redacts the names its
 *     tools return before they go back to the model.
 *   - AC-13: a doctor's voice note lands in the case of the patient he is
 *     seeing now, and never overwrites the draft already there.
 *
 * The routes are covered in p5-ai-routes-gate.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ ai: false }));
vi.mock("@/lib/ai-enabled", () => ({
  get AI_ENABLED() {
    return flags.ai;
  },
}));

const db = vi.hoisted(() => ({
  appointmentFindFirst: vi.fn(),
  caseFindUnique: vi.fn(),
  caseUpdate: vi.fn(async () => ({})),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: vi.fn() },
    lLMUsage: { count: vi.fn(async () => 0), create: vi.fn() },
    auditLog: { create: vi.fn() },
    appointment: { findFirst: db.appointmentFindFirst },
    medicalCase: { findUnique: db.caseFindUnique, update: db.caseUpdate },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import {
  __resetLLMOverridesForTesting,
  __setLLMOverridesForTesting,
  callLLM,
} from "@/server/ai/llm";
import {
  __resetTranscribeOverridesForTesting,
  __setTranscribeOverridesForTesting,
  transcribe,
} from "@/server/ai/transcribe";
import { AIDisabledError, AIProviderNotConfiguredError } from "@/server/ai/availability";
import * as toolsModule from "@/server/ai/tools";
import { askAssistant } from "@/server/ai/tool-loop";
import { findActiveCaseId } from "@/server/telegram/voice-handler";
import { appendSoapDraft } from "@/server/workers/voice-soap";

const ENV = { ...process.env };

beforeEach(() => {
  flags.ai = false;
  process.env = { ...ENV };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_PROVIDER;
  delete process.env.WHISPER_PROVIDER;
  delete process.env.REDIS_URL;
  __resetLLMOverridesForTesting();
  __resetTranscribeOverridesForTesting();
  db.appointmentFindFirst.mockReset();
  db.caseFindUnique.mockReset();
  db.caseUpdate.mockClear();
});

afterEach(() => {
  process.env = ENV;
  vi.restoreAllMocks();
});

function llmSpies() {
  const usage = vi.fn(async () => {});
  const provider = vi.fn(async () => ({ text: "ok", inputTokens: 1, outputTokens: 1 }));
  __setLLMOverridesForTesting({
    countRecentUsage: async () => 0,
    resolvePlanTier: async () => "pro",
    recordUsage: usage,
    recordAudit: async () => {},
    invokeProvider: provider,
  });
  return { usage, provider };
}

const LLM_REQ = {
  clinicId: "c1",
  useCase: "patient.summary" as const,
  messages: [{ role: "user" as const, content: "Пациент Иванова" }],
};

describe("AC-12: the LLM proxy while AI is paused", () => {
  it("refuses before any provider call or usage row", async () => {
    const { usage, provider } = llmSpies();
    await expect(callLLM(LLM_REQ)).rejects.toBeInstanceOf(AIDisabledError);
    expect(provider).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
  });

  it("the transcriber refuses too, without fetching the audio", async () => {
    const usage = vi.fn(async () => {});
    const invoke = vi.fn(async () => ({ text: "x", language: "ru" as const }));
    __setTranscribeOverridesForTesting({ recordUsage: usage, invokeProvider: invoke });
    await expect(
      transcribe({ fileUrl: "https://tg/file", durationSec: 5, clinicId: "c1" }),
    ).rejects.toBeInstanceOf(AIDisabledError);
    expect(invoke).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
  });
});

describe("AC-12: no mock answers in production", () => {
  it("callLLM without a provider key: an error in production, no usage row", async () => {
    flags.ai = true;
    vi.stubEnv("NODE_ENV", "production");
    const usage = vi.fn(async () => {});
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: usage,
      recordAudit: async () => {},
    });
    await expect(callLLM(LLM_REQ)).rejects.toBeInstanceOf(AIProviderNotConfiguredError);
    expect(usage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("an explicit LLM_PROVIDER=mock is refused in production as well", async () => {
    flags.ai = true;
    vi.stubEnv("NODE_ENV", "production");
    process.env.LLM_PROVIDER = "mock";
    llmSpies();
    await expect(callLLM(LLM_REQ)).rejects.toBeInstanceOf(AIProviderNotConfiguredError);
    vi.unstubAllEnvs();
  });

  it("transcribe without OPENAI_API_KEY: an error in production", async () => {
    flags.ai = true;
    vi.stubEnv("NODE_ENV", "production");
    const usage = vi.fn(async () => {});
    __setTranscribeOverridesForTesting({ recordUsage: usage });
    await expect(
      transcribe({ fileUrl: "https://tg/file", durationSec: 5, clinicId: "c1" }),
    ).rejects.toBeInstanceOf(AIProviderNotConfiguredError);
    expect(usage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("outside production the mock still stands in (dev and tests)", async () => {
    flags.ai = true;
    process.env.LLM_PROVIDER = "mock";
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
    });
    const res = await callLLM(LLM_REQ);
    expect(res.text).toContain("[mock-llm");
  });
});

describe("AC-12: names a tool returns are redacted before they go back to the model", () => {
  it("the provider never sees the patient's full name from findPatient", async () => {
    flags.ai = true;
    process.env.LLM_PROVIDER = "mock";
    const seen: string[] = [];
    let call = 0;
    __setLLMOverridesForTesting({
      countRecentUsage: async () => 0,
      resolvePlanTier: async () => "pro",
      recordUsage: async () => {},
      recordAudit: async () => {},
      invokeProvider: async (req) => {
        seen.push(JSON.stringify(req.messages));
        call += 1;
        return call === 1
          ? { text: "", toolCalls: [{ name: "findPatient", input: { query: "Каримова" } }], inputTokens: 1, outputTokens: 1 }
          : { text: "Нашёл: <NAME_1>.", toolCalls: [], inputTokens: 1, outputTokens: 1 };
      },
    });
    vi.spyOn(toolsModule, "getToolDescriptors").mockReturnValue([
      { name: "findPatient", description: "stub", input_schema: { type: "object" } },
    ]);
    vi.spyOn(toolsModule, "executeTool").mockResolvedValue({
      ok: true,
      data: {},
      summary: "Найдено 1 пациент. Первый: Каримова Дилноза Рустамовна.",
      names: ["Каримова Дилноза Рустамовна", "—"],
    });

    const res = await askAssistant({ clinicId: "c1", userId: "u1", locale: "ru", question: "найди" });

    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toContain("Каримова Дилноза Рустамовна");
    expect(seen[1]).toContain("<NAME_1>");
    // The doctor still reads the real name: the proxy restores it.
    expect(res.answer).toBe("Нашёл: Каримова Дилноза Рустамовна.");
  });

  it("every tool that names people reports the names", () => {
    for (const f of ["find-patient", "get-appointments-today", "find-free-slots"]) {
      const src = readFileSync(path.join(process.cwd(), `src/server/ai/tools/${f}.ts`), "utf8");
      expect(src, f).toMatch(/\bnames: /);
    }
  });
});

describe("AC-13: the voice note goes to the patient in the chair", () => {
  it("the case is the one of the doctor's visit in progress", async () => {
    db.appointmentFindFirst.mockResolvedValue({ medicalCaseId: "case_A" });
    expect(await findActiveCaseId("c1", "d1")).toBe("case_A");
    expect(db.appointmentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clinicId: "c1", doctorId: "d1", status: "IN_PROGRESS" },
      }),
    );
  });

  it("no visit in progress, or one without a case: no case (the doctor is told to start the visit)", async () => {
    db.appointmentFindFirst.mockResolvedValue(null);
    expect(await findActiveCaseId("c1", "d1")).toBeNull();
    db.appointmentFindFirst.mockResolvedValue({ medicalCaseId: null });
    expect(await findActiveCaseId("c1", "d1")).toBeNull();
  });

  it("a new dictation is added below the draft already there, never over it", () => {
    expect(appendSoapDraft(null, "### Subjective\nНовое")).toBe("### Subjective\nНовое");
    expect(appendSoapDraft("  ", "Новое")).toBe("Новое");
    expect(appendSoapDraft("Старый черновик врача", "Новое")).toBe(
      "Старый черновик врача\n\n---\n\nНовое",
    );
  });

  it("the worker writes old draft + new dictation, and leaves an unreadable draft alone", () => {
    const src = readFileSync(path.join(process.cwd(), "src/server/workers/voice-soap.ts"), "utf8");
    expect(src).toContain("appendSoapDraft(previous, markdown)");
    expect(src).toContain("draft unreadable, not overwritten");
    expect(src).not.toContain("we always overwrite");
  });
});
