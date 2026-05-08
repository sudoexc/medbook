/**
 * Phase 15 Wave 5 — `src/server/ai/transcribe.ts` unit tests.
 *
 * Whisper has its own tiny client (multipart/form-data + OpenAI-only) so we
 * exercise both the mock branch (deterministic stub) and the env-fallback
 * branch (no OPENAI_API_KEY → mock + warn). The provider invocation itself
 * is faked through `__setTranscribeOverridesForTesting` to avoid network
 * I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lLMUsage: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

import {
  transcribe,
  estimateWhisperCostUzs,
  __setTranscribeOverridesForTesting,
  __resetTranscribeOverridesForTesting,
  type TranscribeInput,
} from "@/server/ai/transcribe";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetTranscribeOverridesForTesting();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  __resetTranscribeOverridesForTesting();
});

function makeInput(overrides: Partial<TranscribeInput> = {}): TranscribeInput {
  return {
    fileUrl: "https://example.test/audio.ogg",
    durationSec: 30,
    language: "ru",
    clinicId: "clinic-1",
    userId: "user-1",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// estimateWhisperCostUzs
// ─────────────────────────────────────────────────────────────────────────────

describe("estimateWhisperCostUzs", () => {
  it("returns 0 for the mock provider regardless of duration", () => {
    expect(estimateWhisperCostUzs("mock", 0)).toBe(0);
    expect(estimateWhisperCostUzs("mock", 600)).toBe(0);
  });

  it("returns 0 for non-positive durations on the openai provider", () => {
    expect(estimateWhisperCostUzs("openai", 0)).toBe(0);
    expect(estimateWhisperCostUzs("openai", -10)).toBe(0);
    expect(estimateWhisperCostUzs("openai", Number.NaN)).toBe(0);
  });

  it("computes cost in tiins for the openai provider", () => {
    // 60s → 0.006 USD → 0.006 × 12700 = 76.2 UZS → ×100 = 7620 tiins
    expect(estimateWhisperCostUzs("openai", 60)).toBe(7620);
    // 30s → half of the above
    expect(estimateWhisperCostUzs("openai", 30)).toBe(3810);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transcribe — mock provider deterministic stub
// ─────────────────────────────────────────────────────────────────────────────

describe("transcribe — mock provider", () => {
  it("returns a deterministic Russian stub when language=ru", async () => {
    process.env.WHISPER_PROVIDER = "mock";

    const recorded: unknown[] = [];
    __setTranscribeOverridesForTesting({
      recordUsage: async (row) => {
        recorded.push(row);
      },
    });

    const r = await transcribe(makeInput({ language: "ru", durationSec: 12 }));
    expect(r.language).toBe("ru");
    expect(r.durationSec).toBe(12);
    expect(r.text).toMatch(/головн/i);
    expect(r.costUzs).toBe(0);
    expect(recorded).toHaveLength(1);
  });

  it("returns a deterministic Uzbek stub when language=uz", async () => {
    process.env.WHISPER_PROVIDER = "mock";
    __setTranscribeOverridesForTesting({ recordUsage: async () => {} });

    const r = await transcribe(makeInput({ language: "uz", durationSec: 5 }));
    expect(r.language).toBe("uz");
    expect(r.text).toMatch(/Bemor/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transcribe — env fallback when OPENAI_API_KEY missing
// ─────────────────────────────────────────────────────────────────────────────

describe("transcribe — missing OPENAI_API_KEY falls back to mock + warns", () => {
  it("emits a warning and produces the mock stub even when provider=openai", async () => {
    process.env.WHISPER_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    const warnings: string[] = [];
    __setTranscribeOverridesForTesting({
      warn: (m) => warnings.push(m),
      recordUsage: async () => {},
    });

    const r = await transcribe(makeInput({ language: "ru", durationSec: 8 }));
    expect(warnings.some((w) => w.includes("OPENAI_API_KEY"))).toBe(true);
    expect(r.text).toMatch(/головн/i);
    // Mock provider → cost is 0 even though provider=openai was requested.
    expect(r.costUzs).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transcribe — provider error propagates after recording failure usage row
// ─────────────────────────────────────────────────────────────────────────────

describe("transcribe — provider error", () => {
  it("records the error in usage and re-throws", async () => {
    process.env.WHISPER_PROVIDER = "mock";
    const recorded: { errorCode: string | null }[] = [];
    __setTranscribeOverridesForTesting({
      invokeProvider: async () => {
        throw new Error("simulated whisper failure");
      },
      recordUsage: async (row) => {
        recorded.push(row);
      },
    });

    await expect(transcribe(makeInput())).rejects.toThrow(
      "simulated whisper failure",
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.errorCode).toBe("provider_error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// transcribe — usage row contents
// ─────────────────────────────────────────────────────────────────────────────

describe("transcribe — usage row payload", () => {
  it("writes useCase=voice.soap, model=whisper-1 with computed cost", async () => {
    process.env.WHISPER_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-fake";

    const recorded: {
      useCase: string;
      model: string;
      provider: string;
      costUzs: number;
    }[] = [];
    __setTranscribeOverridesForTesting({
      invokeProvider: async () => ({
        text: "ok",
        language: "ru" as const,
      }),
      recordUsage: async (row) => {
        recorded.push(row);
      },
    });

    await transcribe(makeInput({ durationSec: 60 }));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.useCase).toBe("voice.soap");
    expect(recorded[0]!.model).toBe("whisper-1");
    expect(recorded[0]!.provider).toBe("openai");
    // 60s → 7620 tiins (matches estimateWhisperCostUzs above).
    expect(recorded[0]!.costUzs).toBe(7620);
  });
});
