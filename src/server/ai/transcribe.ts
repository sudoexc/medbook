/**
 * Phase 15 Wave 5 — Whisper transcription service.
 *
 * Narrow, dedicated client for OpenAI Whisper. Lives outside `llm.ts` because
 * Whisper is OpenAI-specific (Anthropic has no audio endpoint) and the
 * request shape is multipart/form-data, not JSON. Same audit table though —
 * we write a `LLMUsage` row with `useCase: "voice.soap"`, `model:
 * "whisper-1"`, `provider: "openai"` so the dashboard rolls Whisper into the
 * same per-clinic spend / latency view as the Anthropic calls.
 *
 * Privacy contract:
 *   1. Audio is fetched from the URL only at transcribe-time. The URL is
 *      either a short-lived TG file URL or a signed S3/disk URL — either
 *      way it expires fast.
 *   2. The audio bytes never touch our disk. We pipe `fetch().blob()`
 *      straight into the OpenAI multipart form.
 *   3. Once the API response comes back, the in-memory blob is dropped on
 *      the next GC. No `fs.writeFile`, no temp files, no caching.
 *   4. Only the transcript text is returned to the caller (and the worker
 *      stores it on `MedicalCase.soapDraft` — the audio URL is discarded).
 *
 * Provider strategy:
 *   - `process.env.WHISPER_PROVIDER ?? "openai"`. Supported: "openai", "mock".
 *   - "openai" without `OPENAI_API_KEY` falls back to "mock" with a warning,
 *     matching the `llm.ts` policy for missing `ANTHROPIC_API_KEY`.
 *   - "mock" returns a deterministic stub so dev/tests don't need a real
 *     key. The stub mentions the language + duration so a debugger can tell
 *     it apart from "real" output.
 *
 * Cost: $0.006/min for whisper-1. Converted to UZS tiins (×100 of soum) via
 * the same hardcoded 12 700 UZS/USD rate `llm.ts` uses. The audit row
 * stores cost in `LLMUsage.costUzs`; rounding skews under 1 tiin.
 */

import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type TranscribeProvider = "openai" | "mock";

export type TranscribeInput = {
  /** Signed URL the worker can `fetch` server-side. Treated as ephemeral. */
  fileUrl: string;
  language?: "ru" | "uz" | "auto";
  /** Used for cost estimation and the audit row. Defaults to 0 → cost 0. */
  durationSec?: number;
  /**
   * Audit context. The transcribe service writes a `LLMUsage` row exactly
   * like `callLLM` so the dashboard sums Whisper into the same per-clinic
   * spend total. Pass `null` for `userId` when the worker doesn't have one
   * (e.g., a pure system run); the column is nullable.
   */
  clinicId: string;
  userId?: string | null;
};

export type TranscribeResult = {
  text: string;
  language: "ru" | "uz" | "unknown";
  durationSec: number;
  /** Cost in tiins (UZS minor units, ×100). 0 for mock or zero-duration. */
  costUzs: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_API = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";
const WHISPER_USD_PER_MIN = 0.006;
const DEFAULT_USD_TO_UZS = 12700; // Same rate `llm.ts` uses; switch to FX helper later.

// ─────────────────────────────────────────────────────────────────────────────
// Test seam
// ─────────────────────────────────────────────────────────────────────────────

export type TranscribeOverrides = {
  /** Replace the underlying provider call (success or failure). */
  invokeProvider?: (
    input: TranscribeInput,
    provider: TranscribeProvider,
  ) => Promise<{ text: string; language: TranscribeResult["language"] }>;
  /** Override audit emission (tests want to assert without DB). */
  recordUsage?: (row: TranscribeUsageRow) => Promise<void>;
  /** Override warn output for "missing API key" path assertions. */
  warn?: (message: string) => void;
};

let TEST_OVERRIDES: TranscribeOverrides = {};

export function __setTranscribeOverridesForTesting(
  overrides: TranscribeOverrides,
): void {
  TEST_OVERRIDES = overrides;
}

export function __resetTranscribeOverridesForTesting(): void {
  TEST_OVERRIDES = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

type TranscribeUsageRow = {
  clinicId: string;
  userId: string | null;
  useCase: "voice.soap";
  provider: TranscribeProvider;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
  latencyMs: number;
  cacheHit: boolean;
  errorCode: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider selection
// ─────────────────────────────────────────────────────────────────────────────

function emitWarn(message: string): void {
  if (TEST_OVERRIDES.warn) {
    TEST_OVERRIDES.warn(message);
    return;
  }
  console.warn(message);
}

function resolveProvider(): TranscribeProvider {
  const env = (process.env.WHISPER_PROVIDER ?? "openai") as TranscribeProvider;
  if (env === "openai" && !process.env.OPENAI_API_KEY) {
    emitWarn(
      "[transcribe] OPENAI_API_KEY missing; falling back to mock provider. " +
        "Set OPENAI_API_KEY for real Whisper transcription.",
    );
    return "mock";
  }
  if (env === "mock") return "mock";
  if (env === "openai") return "openai";
  // Unknown setting → mock (safest default for dev).
  emitWarn(
    `[transcribe] Unsupported WHISPER_PROVIDER="${env}"; falling back to mock.`,
  );
  return "mock";
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whisper cost in tiins for a given duration. Mock provider always returns 0.
 */
export function estimateWhisperCostUzs(
  provider: TranscribeProvider,
  durationSec: number,
): number {
  if (provider === "mock") return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const usd = (durationSec / 60) * WHISPER_USD_PER_MIN;
  return Math.round(usd * DEFAULT_USD_TO_UZS * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementations
// ─────────────────────────────────────────────────────────────────────────────

async function invokeMock(
  input: TranscribeInput,
): Promise<{ text: string; language: TranscribeResult["language"] }> {
  const lang = input.language === "uz" ? "uz" : "ru";
  const dur = Math.round(input.durationSec ?? 0);
  return {
    text:
      lang === "uz"
        ? `[mock-transcript uz ~${dur}s] Bemor bosh og'rig'i haqida shikoyat qilmoqda.`
        : `[mock-transcript ru ~${dur}s] Пациент жалуется на головную боль.`,
    language: lang as "ru" | "uz",
  };
}

/**
 * Real OpenAI Whisper call. Fetches the audio bytes once, posts them as
 * multipart form-data, returns the parsed text + detected language.
 *
 * The input audio is read into memory via `Response.blob()` and never
 * persisted. Once the OpenAI response settles, the blob is unreferenced.
 */
async function invokeOpenAI(
  input: TranscribeInput,
): Promise<{ text: string; language: TranscribeResult["language"] }> {
  const apiKey = process.env.OPENAI_API_KEY ?? "";

  // 1) Fetch the audio. Short timeout — TG/file URLs are ephemeral and the
  //    server is on the same network as the storage in most setups.
  const audioRes = await fetch(input.fileUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!audioRes.ok) {
    throw new Error(
      `Failed to fetch audio: ${audioRes.status} ${audioRes.statusText}`,
    );
  }
  const blob = await audioRes.blob();

  // 2) Build multipart form. We use the WHATWG FormData built into Node 18+;
  //    `Blob` is the streamable file body OpenAI expects.
  const form = new FormData();
  form.append("file", blob, "audio.ogg");
  form.append("model", WHISPER_MODEL);
  // `verbose_json` returns `{ text, language, duration, segments }` so we can
  // pull the detected language without an extra heuristic.
  form.append("response_format", "verbose_json");
  if (input.language && input.language !== "auto") {
    form.append("language", input.language);
  }

  // 3) POST. Generous timeout — Whisper is slower on cold infra; we still
  //    cap so a hung request doesn't block the worker forever.
  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI Whisper failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    text?: string;
    language?: string;
  };
  const text = (j.text ?? "").trim();
  const langRaw = (j.language ?? "").toLowerCase();
  const language: TranscribeResult["language"] =
    langRaw === "russian" || langRaw === "ru"
      ? "ru"
      : langRaw === "uzbek" || langRaw === "uz"
        ? "uz"
        : "unknown";
  return { text, language };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

async function defaultRecordUsage(row: TranscribeUsageRow): Promise<void> {
  try {
    await prisma.lLMUsage.create({ data: row });
    // Also write a parallel audit log entry so the dashboard view that
    // joins on AuditLog (LLM_CALL) sees Whisper rows too.
    await prisma.auditLog.create({
      data: {
        clinicId: row.clinicId,
        actorId: row.userId,
        actorRole: row.userId ? null : "SYSTEM",
        actorLabel: row.userId ? null : "transcribe",
        action: AUDIT_ACTION.LLM_CALL,
        entityType: "LLMUsage",
        entityId: null,
        meta: {
          useCase: row.useCase,
          provider: row.provider,
          model: row.model,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          costUzs: row.costUzs,
          latencyMs: row.latencyMs,
          cacheHit: row.cacheHit,
          errorCode: row.errorCode,
          promptHash: row.promptHash,
        },
      },
    });
  } catch (err) {
    // Audit / usage write failure is non-fatal — the transcript still
    // returns to the caller.
    console.error("[transcribe:audit]", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function transcribe(
  input: TranscribeInput,
): Promise<TranscribeResult> {
  const provider = resolveProvider();
  const startedAt = Date.now();
  const durationSec =
    input.durationSec && Number.isFinite(input.durationSec)
      ? Math.max(0, Math.floor(input.durationSec))
      : 0;

  let text = "";
  let language: TranscribeResult["language"] = "unknown";
  let errorCode: string | null = null;

  try {
    const invoke = TEST_OVERRIDES.invokeProvider
      ? TEST_OVERRIDES.invokeProvider
      : provider === "mock"
        ? invokeMock
        : invokeOpenAI;
    const out = await invoke(input, provider);
    text = out.text;
    language = out.language;
  } catch (err) {
    errorCode = "provider_error";
    // Re-throw after recording the failure usage row.
    const latencyMs = Date.now() - startedAt;
    await (TEST_OVERRIDES.recordUsage ?? defaultRecordUsage)({
      clinicId: input.clinicId,
      userId: input.userId ?? null,
      useCase: "voice.soap",
      provider,
      model: WHISPER_MODEL,
      promptHash: "",
      inputTokens: 0,
      outputTokens: 0,
      costUzs: 0,
      latencyMs,
      cacheHit: false,
      errorCode,
    });
    throw err;
  }

  const latencyMs = Date.now() - startedAt;
  const costUzs = estimateWhisperCostUzs(provider, durationSec);

  // Whisper has no token concept; we store duration-as-input "tokens" for
  // dashboard reporting (input=durationSec×100 ≈ char-equivalent). Keep at
  // 0 to avoid muddying the per-token cost charts that exist for the LLM
  // proxy. The dashboard distinguishes Whisper rows by `model = whisper-1`.
  await (TEST_OVERRIDES.recordUsage ?? defaultRecordUsage)({
    clinicId: input.clinicId,
    userId: input.userId ?? null,
    useCase: "voice.soap",
    provider,
    model: WHISPER_MODEL,
    promptHash: "",
    inputTokens: 0,
    outputTokens: 0,
    costUzs,
    latencyMs,
    cacheHit: false,
    errorCode: null,
  });

  return {
    text,
    language,
    durationSec,
    costUzs,
  };
}
