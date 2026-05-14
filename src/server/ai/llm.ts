/**
 * Phase 15 Wave 1 — LLM proxy.
 *
 * Single entry point for every LLM call in the app. Responsibilities:
 *
 *   1. Provider selection (`anthropic` | `mock`). OpenAI / Ollama can be
 *      added later; the dispatcher pattern below keeps that trivial.
 *   2. PII redaction of `system` + every `messages.content` BEFORE the
 *      provider sees them. The reverse mapping is applied to the response
 *      text so callers always see the un-redacted output.
 *   3. Per-clinic daily rate limit by plan tier (basic / pro / enterprise).
 *      Counted off `LLMUsage`. Exceeded → throws `LLMRateLimitError`, and a
 *      `LLMUsage` row is still written with `errorCode: 'rate_limit'` so
 *      the dashboard can show throttling stats.
 *   4. Response cache (Redis, 1h TTL) keyed on the redacted prompt hash.
 *      No-op when REDIS_URL is unset.
 *   5. Cost estimation in tiins (UZS minor units, ×100). Hardcoded 12 700
 *      UZS/USD until the FX-from-DB helper is wired.
 *   6. Audit: one `AuditLog{action: 'LLM_CALL'}` row per call AND one
 *      `LLMUsage` row. Audit failures never break the call.
 *
 * Wave 1 deliberately ships only the proxy plumbing; the five use-case
 * call sites land in Waves 2–4. Tests in `tests/unit/ai-llm-proxy.test.ts`
 * cover redaction, rate-limit, cache, and cost.
 */

import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";

import { redactWithKnownNames, unredact } from "./redact";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type LLMUseCase =
  | "patient.summary"
  | "cmdk.search"
  | "voice.soap"
  | "tg.intent"
  | "marketing.copy"
  | "reception.clarifying"
  | "reception.icd10"
  | "reception.conclusion";

export type LLMProvider = "anthropic" | "openai" | "ollama" | "mock";

export type LLMTool = {
  name: string;
  description: string;
  /** JSON schema. Keep as `object` so providers can pass through verbatim. */
  input_schema: object;
};

export type LLMRequest = {
  clinicId: string;
  userId?: string;
  useCase: LLMUseCase;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * Patient / doctor names to scrub from every message + system prompt
   * before the provider sees them. The LLM proxy will not call out without
   * applying this list — pass `[]` only if you really have no names.
   */
  knownNames?: string[];
  maxTokens?: number;
  temperature?: number;
  tools?: LLMTool[];
};

export type LLMToolCall = {
  name: string;
  input: unknown;
};

export type LLMResponse = {
  text: string;
  toolCalls?: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  latencyMs: number;
  /** Cost in tiins (UZS minor units, ×100). 0 when unknown. */
  costUzs: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class LLMRateLimitError extends Error {
  readonly clinicId: string;
  readonly limit: number;
  readonly windowHours: number;

  constructor(clinicId: string, limit: number, windowHours = 24) {
    super(
      `LLM daily rate limit exceeded for clinic ${clinicId}: ${limit} calls in the last ${windowHours}h`,
    );
    this.name = "LLMRateLimitError";
    this.clinicId = clinicId;
    this.limit = limit;
    this.windowHours = windowHours;
  }
}

export class LLMRedactionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LLMRedactionError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Daily call ceiling per clinic plan tier. Counted from `LLMUsage` rows in
 * the trailing 24h. The `basic` floor is intentionally low — a single
 * runaway prompt loop should not burn the monthly budget.
 *
 * Plan tier resolution: derived from the clinic's `Subscription.plan.slug`.
 * Unknown / cancelled / no subscription → `basic`.
 */
export const LLM_DAILY_LIMIT_BY_PLAN = {
  basic: 200,
  pro: 1000,
  enterprise: 10000,
} as const;

export type LLMPlanTier = keyof typeof LLM_DAILY_LIMIT_BY_PLAN;

/**
 * Cost per million tokens, USD, per (provider, model). Ballpark figures
 * pulled from each vendor's public pricing page; refine as reality bites.
 */
const COST_TABLE: Record<string, { input: number; output: number }> = {
  "anthropic:claude-sonnet-4-6": { input: 3, output: 15 },
  "anthropic:claude-haiku-4-6": { input: 0.8, output: 4 },
  "anthropic:claude-opus-4-7": { input: 15, output: 75 },
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai:gpt-4o": { input: 5, output: 15 },
  "ollama:default": { input: 0, output: 0 },
  "mock:mock": { input: 0, output: 0 },
};

const DEFAULT_USD_TO_UZS = 12700; // ~May 2026 rate; replace with FX helper later.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const CACHE_TTL_SECONDS = 60 * 60; // 1h

// ─────────────────────────────────────────────────────────────────────────────
// Test seams
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test-only injection points. Production code never sets these; the unit
 * test suite uses them to stub the rate-limit DB count and the Redis
 * client without mocking Prisma at the module level.
 */
export type LLMOverrides = {
  /** Returns the count of LLMUsage rows for the clinic in the last 24h. */
  countRecentUsage?: (clinicId: string) => Promise<number>;
  /** Resolve the clinic plan tier (basic | pro | enterprise). */
  resolvePlanTier?: (clinicId: string) => Promise<LLMPlanTier>;
  /** Persist a usage row. Tests can spy on the payload. */
  recordUsage?: (row: LLMUsageRow) => Promise<void>;
  /** Fire the audit log. Tests can no-op this. */
  recordAudit?: (row: LLMAuditRow) => Promise<void>;
  /** Stub the provider client (mock or real). */
  invokeProvider?: (req: ProviderRequest) => Promise<ProviderResult>;
  /** In-memory cache stub. */
  cacheGet?: (key: string) => Promise<string | null>;
  cacheSet?: (key: string, value: string, ttlSec: number) => Promise<void>;
  /** Override the warning emitter (tests want to assert on it). */
  warn?: (message: string) => void;
};

let TEST_OVERRIDES: LLMOverrides = {};

/** Internal: install/replace test overrides. Not exported for production use. */
export function __setLLMOverridesForTesting(overrides: LLMOverrides): void {
  TEST_OVERRIDES = overrides;
}

/** Internal: clear all overrides. */
export function __resetLLMOverridesForTesting(): void {
  TEST_OVERRIDES = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

type LLMUsageRow = {
  clinicId: string;
  userId: string | null;
  useCase: string;
  provider: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
  latencyMs: number;
  cacheHit: boolean;
  errorCode: string | null;
};

type LLMAuditRow = {
  clinicId: string;
  userId: string | null;
  useCase: string;
  provider: string;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
  latencyMs: number;
  cacheHit: boolean;
  errorCode: string | null;
};

type ProviderRequest = {
  provider: LLMProvider;
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  temperature: number;
  tools?: LLMTool[];
};

type ProviderResult = {
  text: string;
  toolCalls?: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider selection
// ─────────────────────────────────────────────────────────────────────────────

function resolveProvider(): { provider: LLMProvider; model: string } {
  const envProvider = (process.env.LLM_PROVIDER ?? "anthropic") as LLMProvider;
  const model = process.env.LLM_DEFAULT_MODEL ?? DEFAULT_MODEL;

  if (envProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    emitWarn(
      "[llm] ANTHROPIC_API_KEY missing; falling back to mock provider. " +
        "Set LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY for real calls.",
    );
    return { provider: "mock", model: "mock" };
  }

  if (envProvider === "mock") return { provider: "mock", model: "mock" };
  if (envProvider === "anthropic") return { provider: "anthropic", model };

  // Unsupported provider — Wave 1 only wires anthropic + mock.
  emitWarn(
    `[llm] Unsupported LLM_PROVIDER="${envProvider}"; falling back to mock.`,
  );
  return { provider: "mock", model: "mock" };
}

function emitWarn(message: string): void {
  if (TEST_OVERRIDES.warn) {
    TEST_OVERRIDES.warn(message);
    return;
  }
  console.warn(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan / rate limit
// ─────────────────────────────────────────────────────────────────────────────

async function defaultResolvePlanTier(clinicId: string): Promise<LLMPlanTier> {
  try {
    // Read directly off Subscription so we can map the plan slug to a tier.
    // `getFeatureFlags` returns booleans only; we want the raw tier name.
    const sub = await prisma.subscription.findUnique({
      where: { clinicId },
      include: { plan: true },
    });
    if (!sub) return "basic";
    if (sub.status === "CANCELLED") return "basic";
    const slug = (sub.plan?.slug ?? "").toLowerCase();
    if (slug === "enterprise") return "enterprise";
    if (slug === "pro") return "pro";
    return "basic";
  } catch {
    // Ensure a missing DB never crashes the proxy in dev/local.
    return "basic";
  }
}

async function defaultCountRecentUsage(clinicId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.lLMUsage.count({
    where: { clinicId, createdAt: { gte: since } },
  });
}

async function checkRateLimit(clinicId: string): Promise<{
  allowed: boolean;
  limit: number;
  tier: LLMPlanTier;
}> {
  const tier = await (TEST_OVERRIDES.resolvePlanTier ?? defaultResolvePlanTier)(
    clinicId,
  );
  const limit = LLM_DAILY_LIMIT_BY_PLAN[tier];
  const used = await (TEST_OVERRIDES.countRecentUsage ??
    defaultCountRecentUsage)(clinicId);
  return { allowed: used < limit, limit, tier };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

async function defaultRecordUsage(row: LLMUsageRow): Promise<void> {
  try {
    await prisma.lLMUsage.create({ data: row });
  } catch (err) {
    console.error("[llm:usage]", err);
  }
}

async function defaultRecordAudit(row: LLMAuditRow): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: row.clinicId,
        actorId: row.userId,
        actorRole: row.userId ? null : "SYSTEM",
        actorLabel: row.userId ? null : "llm-proxy",
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
    // Audit failure is non-fatal — match `src/lib/audit.ts` behaviour.
    console.error("[llm:audit]", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache (Redis, lazy)
// ─────────────────────────────────────────────────────────────────────────────

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
};

let cachedRedis: RedisLike | null = null;
let redisProbed = false;

async function getRedis(): Promise<RedisLike | null> {
  if (TEST_OVERRIDES.cacheGet || TEST_OVERRIDES.cacheSet) return null;
  if (redisProbed) return cachedRedis;
  redisProbed = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const mod = (await import("ioredis")) as { default: new (url: string, opts?: unknown) => RedisLike };
    const Redis = mod.default;
    cachedRedis = new Redis(process.env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
    });
  } catch (err) {
    emitWarn(`[llm:cache] Redis unavailable (${(err as Error).message}); skipping cache.`);
    cachedRedis = null;
  }
  return cachedRedis;
}

async function cacheGet(key: string): Promise<string | null> {
  if (TEST_OVERRIDES.cacheGet) return TEST_OVERRIDES.cacheGet(key);
  const r = await getRedis();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string): Promise<void> {
  if (TEST_OVERRIDES.cacheSet) {
    await TEST_OVERRIDES.cacheSet(key, value, CACHE_TTL_SECONDS);
    return;
  }
  const r = await getRedis();
  if (!r) return;
  try {
    await r.set(key, value, "EX", CACHE_TTL_SECONDS);
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementations
// ─────────────────────────────────────────────────────────────────────────────

async function invokeMock(req: ProviderRequest): Promise<ProviderResult> {
  const last = req.messages[req.messages.length - 1]?.content ?? "";
  const slice = last.slice(0, 50);
  return {
    text: `[mock-llm: ${req.model}] ${slice}`,
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}

async function invokeAnthropic(req: ProviderRequest): Promise<ProviderResult> {
  // Lazy import so test envs without the SDK don't crash.
  const mod = (await import("@anthropic-ai/sdk")) as {
    default: new (opts: { apiKey: string }) => {
      messages: {
        create: (params: unknown) => Promise<{
          content: Array<
            | { type: "text"; text: string }
            | { type: "tool_use"; name: string; input: unknown }
          >;
          usage?: { input_tokens?: number; output_tokens?: number };
        }>;
      };
    };
  };
  const Client = mod.default;
  const client = new Client({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  const params: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    messages: req.messages,
  };
  if (req.system) params.system = req.system;
  if (req.tools && req.tools.length > 0) params.tools = req.tools;

  const resp = await client.messages.create(params);

  let text = "";
  const toolCalls: LLMToolCall[] = [];
  for (const block of resp.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({ name: block.name, input: block.input });
    }
  }
  return {
    text,
    toolCalls,
    inputTokens: resp.usage?.input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0,
  };
}

async function invokeProvider(req: ProviderRequest): Promise<ProviderResult> {
  if (TEST_OVERRIDES.invokeProvider) return TEST_OVERRIDES.invokeProvider(req);
  if (req.provider === "mock") return invokeMock(req);
  if (req.provider === "anthropic") return invokeAnthropic(req);
  // Unreachable in Wave 1 — resolveProvider() filters unsupported entries.
  throw new Error(`Unsupported provider: ${req.provider}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate cost in tiins (UZS minor units, ×100 of soum).
 *
 * `pricing` is per million tokens in USD. We convert via a hardcoded
 * 12 700 UZS/USD rate; the FX helper that reads from `ExchangeRate` will
 * land in a follow-up. Returns 0 when the model isn't in the cost table.
 */
export function estimateCostUzs(
  provider: LLMProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const key = `${provider}:${model}`;
  const pricing = COST_TABLE[key];
  if (!pricing) return 0;
  const usd =
    (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  // Soum × 100 = tiins.
  return Math.round(usd * DEFAULT_USD_TO_UZS * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hashing
// ─────────────────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function buildPromptHash(
  provider: LLMProvider,
  model: string,
  redactedSystem: string | undefined,
  redactedMessages: Array<{ role: string; content: string }>,
): string {
  const serialized = JSON.stringify({
    provider,
    model,
    system: redactedSystem ?? "",
    messages: redactedMessages,
  });
  return sha256(serialized);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function callLLM(req: LLMRequest): Promise<LLMResponse> {
  const { provider, model } = resolveProvider();
  const knownNames = req.knownNames ?? [];
  const startedAt = Date.now();

  // 1) Redact every text field. Aggregate replacements so we can unredact
  //    the response. Wrap in try/catch — redaction failure is recorded as
  //    a usage row and re-thrown.
  let redactedSystem: string | undefined;
  let redactedMessages: Array<{ role: "user" | "assistant"; content: string }>;
  let allReplacements: Awaited<ReturnType<typeof redactWithKnownNames>>["replacements"] = [];
  try {
    if (req.system) {
      const r = redactWithKnownNames(req.system, knownNames);
      redactedSystem = r.redacted;
      allReplacements = allReplacements.concat(r.replacements);
    }
    redactedMessages = req.messages.map((m) => {
      const r = redactWithKnownNames(m.content, knownNames);
      allReplacements = allReplacements.concat(r.replacements);
      return { role: m.role, content: r.redacted };
    });
  } catch (err) {
    await persistFailure({
      clinicId: req.clinicId,
      userId: req.userId ?? null,
      useCase: req.useCase,
      provider,
      model,
      promptHash: "",
      errorCode: "redaction_failure",
      latencyMs: Date.now() - startedAt,
    });
    throw new LLMRedactionError("Redaction failed", err);
  }

  const promptHash = buildPromptHash(
    provider,
    model,
    redactedSystem,
    redactedMessages,
  );

  // 2) Rate limit. We consult LLMUsage and bail if the clinic is over.
  const { allowed, limit } = await checkRateLimit(req.clinicId);
  if (!allowed) {
    await persistFailure({
      clinicId: req.clinicId,
      userId: req.userId ?? null,
      useCase: req.useCase,
      provider,
      model,
      promptHash,
      errorCode: "rate_limit",
      latencyMs: Date.now() - startedAt,
    });
    throw new LLMRateLimitError(req.clinicId, limit);
  }

  // 3) Cache lookup (provider+model+redacted prompt).
  const cacheKey = `llm:cache:${promptHash}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as {
        text: string;
        toolCalls?: LLMToolCall[];
        inputTokens: number;
        outputTokens: number;
      };
      const text = unredact(parsed.text, allReplacements);
      const latencyMs = Date.now() - startedAt;
      const costUzs = estimateCostUzs(
        provider,
        model,
        parsed.inputTokens,
        parsed.outputTokens,
      );
      await persistSuccess({
        clinicId: req.clinicId,
        userId: req.userId ?? null,
        useCase: req.useCase,
        provider,
        model,
        promptHash,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        costUzs,
        latencyMs,
        cacheHit: true,
      });
      return {
        text,
        toolCalls: parsed.toolCalls,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheHit: true,
        latencyMs,
        costUzs,
      };
    } catch {
      // corrupted cache entry — fall through to a real call.
    }
  }

  // 4) Real provider call.
  let providerResult: ProviderResult;
  try {
    providerResult = await invokeProvider({
      provider,
      model,
      system: redactedSystem,
      messages: redactedMessages,
      maxTokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      tools: req.tools,
    });
  } catch (err) {
    await persistFailure({
      clinicId: req.clinicId,
      userId: req.userId ?? null,
      useCase: req.useCase,
      provider,
      model,
      promptHash,
      errorCode: "provider_error",
      latencyMs: Date.now() - startedAt,
    });
    throw err;
  }

  const latencyMs = provider === "mock" ? 5 : Date.now() - startedAt;
  const costUzs = estimateCostUzs(
    provider,
    model,
    providerResult.inputTokens,
    providerResult.outputTokens,
  );

  // 5) Cache (store the redacted response — unredaction is per-request).
  await cacheSet(
    cacheKey,
    JSON.stringify({
      text: providerResult.text,
      toolCalls: providerResult.toolCalls,
      inputTokens: providerResult.inputTokens,
      outputTokens: providerResult.outputTokens,
    }),
  );

  // 6) Audit + usage. Fire-and-forget — never gates the response.
  await persistSuccess({
    clinicId: req.clinicId,
    userId: req.userId ?? null,
    useCase: req.useCase,
    provider,
    model,
    promptHash,
    inputTokens: providerResult.inputTokens,
    outputTokens: providerResult.outputTokens,
    costUzs,
    latencyMs,
    cacheHit: false,
  });

  return {
    text: unredact(providerResult.text, allReplacements),
    toolCalls: providerResult.toolCalls,
    inputTokens: providerResult.inputTokens,
    outputTokens: providerResult.outputTokens,
    cacheHit: false,
    latencyMs,
    costUzs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────────────────

type SuccessInput = {
  clinicId: string;
  userId: string | null;
  useCase: LLMUseCase;
  provider: LLMProvider;
  model: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
  latencyMs: number;
  cacheHit: boolean;
};

type FailureInput = {
  clinicId: string;
  userId: string | null;
  useCase: LLMUseCase;
  provider: LLMProvider;
  model: string;
  promptHash: string;
  errorCode: "rate_limit" | "redaction_failure" | "provider_error";
  latencyMs: number;
};

async function persistSuccess(input: SuccessInput): Promise<void> {
  const usage: LLMUsageRow = {
    clinicId: input.clinicId,
    userId: input.userId,
    useCase: input.useCase,
    provider: input.provider,
    model: input.model,
    promptHash: input.promptHash,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costUzs: input.costUzs,
    latencyMs: input.latencyMs,
    cacheHit: input.cacheHit,
    errorCode: null,
  };
  await Promise.all([
    (TEST_OVERRIDES.recordUsage ?? defaultRecordUsage)(usage),
    (TEST_OVERRIDES.recordAudit ?? defaultRecordAudit)({ ...usage }),
  ]);
}

async function persistFailure(input: FailureInput): Promise<void> {
  const usage: LLMUsageRow = {
    clinicId: input.clinicId,
    userId: input.userId,
    useCase: input.useCase,
    provider: input.provider,
    model: input.model,
    promptHash: input.promptHash,
    inputTokens: 0,
    outputTokens: 0,
    costUzs: 0,
    latencyMs: input.latencyMs,
    cacheHit: false,
    errorCode: input.errorCode,
  };
  await Promise.all([
    (TEST_OVERRIDES.recordUsage ?? defaultRecordUsage)(usage),
    (TEST_OVERRIDES.recordAudit ?? defaultRecordAudit)({ ...usage }),
  ]);
}
