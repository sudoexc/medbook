/**
 * Server-side AI gate (audits AC-12, AC-13).
 *
 * `AI_ENABLED` (src/lib/ai-enabled.ts) is the one switch for the AI surface.
 * It used to act on the interface only: with the panels hidden, every
 * `/api/crm/ai/*` route still answered, the NL assistant could send patient
 * names to the provider while AI was officially paused, and without a
 * provider key the proxy quietly swapped in a mock whose «[mock-llm: mock]»
 * text came back as a real answer (and was written into a case's SOAP
 * draft by the voice pipeline).
 *
 * Now:
 *   - the LLM proxy and the transcriber refuse while AI is off
 *     (`AIDisabledError`), before any provider call or `LLMUsage` row;
 *   - in production a missing provider key is an error
 *     (`AIProviderNotConfiguredError`), never a mock: a stand-in text must
 *     not reach a doctor, a patient or a record;
 *   - the LLM routes answer 503 `ai_disabled` / `ai_not_configured`.
 *
 * The rule-based helpers under /api/crm/ai (queue score, ETA, reassign,
 * prescription warnings) call no model and stay available: reception and
 * the doctor's visit screen use them every day.
 */
import { AI_ENABLED } from "@/lib/ai-enabled";
import { err } from "@/server/http";

export class AIDisabledError extends Error {
  constructor() {
    super("AI is disabled (AI_ENABLED = false)");
    this.name = "AIDisabledError";
  }
}

export class AIProviderNotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured; mock providers are not used in production`);
    this.name = "AIProviderNotConfiguredError";
  }
}

/** Is the AI surface switched on? */
export function isAiEnabled(): boolean {
  return AI_ENABLED;
}

/** Throw `AIDisabledError` while AI is off. */
export function assertAiEnabled(): void {
  if (!isAiEnabled()) throw new AIDisabledError();
}

/**
 * May a mock provider stand in for a missing key? Only outside production:
 * dev and tests run without keys; a live clinic must get an error instead.
 */
export function mockProviderAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** The answer of an LLM route while AI is off. */
export function aiDisabledResponse(): Response {
  return err("ai_disabled", 503);
}

/**
 * Map the gate's errors to a route answer, null for any other error (the
 * route keeps its own handling for those).
 */
export function aiUnavailableResponse(e: unknown): Response | null {
  if (e instanceof AIDisabledError) return aiDisabledResponse();
  if (e instanceof AIProviderNotConfiguredError) return err("ai_not_configured", 503);
  return null;
}
