/**
 * Phase 15 Wave 3 — shared types for the NL Command Bar tool registry.
 *
 * Every tool in `src/server/ai/tools/*.ts` exports a `Tool` instance so the
 * registry (`./index.ts`) can dispatch by name. The shape mirrors the
 * Anthropic tool-use spec (name + description + input_schema) plus an
 * `execute` callback we run in-process.
 *
 * Keep this file dependency-free — tool implementations import it; tests
 * import it; the loop imports it. Pulling in Prisma here would force every
 * caller to drag the schema in transitively.
 */

export type ToolContext = {
  clinicId: string;
  userId: string;
  locale: "ru" | "uz";
};

export type ChipKind = "action" | "patient" | "slot" | "appointment";

export type Chip = {
  label: string;
  deeplink: string;
  kind: ChipKind;
};

/**
 * Standard tool result. `summary` is what the LLM reads back to ground its
 * answer — keep it short, factual, no deeplinks. `data` is the full
 * structured payload for the UI / audit trail. `chips` are the deeplinks
 * the user will click; aggregated by the loop into the final response.
 */
export type ToolResult = {
  ok: boolean;
  data: unknown;
  summary: string;
  chips?: Chip[];
  /**
   * Every person's name the result carries (patients, doctors). The loop
   * hands them to the LLM proxy as `knownNames`, so the summary that goes
   * back to the model reaches it with `<NAME_N>` tokens instead of the
   * names (audit AC-12); the proxy restores them in the final answer.
   */
  names?: string[];
};

export type Tool<TInput = unknown> = {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input. Passed to the provider verbatim. */
  input_schema: Record<string, unknown>;
  execute: (input: TInput, context: ToolContext) => Promise<ToolResult>;
};
